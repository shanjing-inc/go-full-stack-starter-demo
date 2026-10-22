const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createHarness } = require("./harness.cjs");

// 执行固定发布包的方法与生命周期；只隔离微信注册、setData 和 WXML 属性求值。
function nativeRuntime() {
    const root = path.join(
        path.dirname(require.resolve("tdesign-miniprogram/package.json")),
        "miniprogram_dist",
    );
    const definitions = new Map();
    const modules = new Map();
    let registering;
    const context = vm.createContext({
        wx: { getAppBaseInfo: () => ({ SDKVersion: "3.11.0" }) },
        getApp: () => ({}),
        Behavior: (definition) => definition,
        Component: (definition) => definitions.set(registering, definition),
    });
    function load(file) {
        if (modules.has(file)) return modules.get(file).exports;
        const module = { exports: {} };
        modules.set(file, module);
        const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(
            (id) =>
                id.startsWith(".")
                    ? load(path.resolve(path.dirname(file), id) + (id.endsWith(".js") ? "" : ".js"))
                    : require(id),
            module,
            module.exports,
        );
        return module.exports;
    }
    function definition(name) {
        if (!definitions.has(name)) {
            registering = name;
            load(path.join(root, name, name + ".js"));
        }
        return definitions.get(name);
    }
    function instance(def, props) {
        const defaults = Object.fromEntries(
            Object.entries(def.properties).map(([key, value]) => [
                key,
                value.value !== undefined
                    ? structuredClone(value.value)
                    : { String: "", Number: 0, Boolean: false, Array: [], Object: null }[
                          value.type?.name
                      ],
            ]),
        );
        const properties = { ...defaults, ...props };
        const self = {
            properties,
            data: { ...structuredClone(def.data), ...properties },
            ...def.methods,
            $children: [],
            selectAllComponents: () => [],
            events: [],
            setData(values) {
                Object.assign(this.data, values);
            },
            triggerEvent(name, detail) {
                this.events.push({ name, detail });
            },
        };
        def.lifetimes.created?.call(self);
        def.lifetimes.attached?.call(self);
        for (const [key, observer] of Object.entries(def.observers ?? {})) {
            if (key in properties) observer.call(self, properties[key]);
        }
        return self;
    }
    function update(def, self, props) {
        const changed = Object.keys(props).filter(
            (key) => !Object.is(self.properties[key], props[key]),
        );
        Object.assign(self.properties, props);
        Object.assign(self.data, props);
        for (const key of changed) def.observers?.[key]?.call(self, props[key]);
    }
    function child(name, group, index = 0) {
        const items = group.data[name === "checkbox" ? "checkboxOptions" : "radioOptions"];
        const wxml = fs.readFileSync(
            path.join(root, name + "-group", name + "-group.wxml"),
            "utf8",
        );
        const tag = wxml.match(new RegExp(`<t-${name}\\s[^>]*>`))[0];
        const expression = tag.match(/\sreadonly="\{\{(.*?)\}\}"/)[1];
        const disabledExpression = tag.match(/\sdisabled="\{\{(.*?)\}\}"/)[1];
        const def = definition(name);
        group.$children = Array.from(items, (item) => {
            const readonly = vm.runInNewContext(expression, { ...group.data, item });
            const disabled = vm.runInNewContext(disabledExpression, { ...group.data, item });
            const child = instance(def, { ...item, readonly, disabled, checked: !!item.checked });
            child.$parent = group;
            return child;
        });
        const self = group.$children[index];
        if (!self) return;
        def.methods.handleTap.call(self, { currentTarget: { dataset: {} } });
        return self;
    }
    return { definition, instance, update, child };
}

test("多选组禁用优先于单项启用，解除后恢复单项状态并保留非受控选择", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { CheckboxGroup } = h.source("components/ui/checkbox-group.tsx");
    const native = nativeRuntime();
    const def = native.definition("checkbox-group");
    for (const controlled of [false, true]) {
        for (const keys of [undefined, { label: "text", value: "id" }]) {
            const labelKey = keys?.label ?? "label";
            const valueKey = keys?.value ?? "value";
            const options = [
                { [labelKey]: "商品", [valueKey]: "goods", disabled: false },
                { [labelKey]: "停用", [valueKey]: "locked", disabled: true },
                { [labelKey]: "只读", [valueKey]: "readonly", readonly: true },
                "orders",
                7,
            ];
            const original = structuredClone(options);
            const props = { options, keys, ...(controlled ? { value: [] } : { defaultValue: [] }) };
            const render = (disabled) => h.renderComponent(CheckboxGroup, { ...props, disabled });
            const initial = render(false);
            const group = native.instance(def, initial.props);
            native.child("checkbox", group);
            assert.equal(group.events.length, 1);
            const selected = JSON.stringify(group.data.value);
            const disabled = render(true);
            assert.equal(render(true).props.options, disabled.props.options, "稳定渲染不重建选项");
            assert.equal(disabled.key, initial.key, "禁用切换复用原生组");
            native.update(def, group, disabled.props);
            for (let index = 0; index < options.length; index++) {
                const child = native.child("checkbox", group, index);
                assert.equal(child.data._disabled, true);
            }
            assert.equal(group.events.length, 1, "禁用期间原生组不发 change");
            assert.equal(JSON.stringify(group.data.value), selected, "禁用期间内部值保持原样");
            native.update(def, group, render(false).props);
            native.child("checkbox", group, 1);
            native.child("checkbox", group, 2);
            assert.equal(group.events.length, 1, "解除组禁用仍保留单项禁用和只读");
            assert.equal(JSON.stringify(group.data.value), selected, "切换禁用不重置已有选择");
            native.child("checkbox", group, 3);
            assert.equal(group.events.length, 2, "解除禁用后恢复选择");
            assert.ok(group.events[1].detail.value.includes("orders"));
            if (!controlled) assert.ok(group.data.value.includes("goods"));
            const restored = native.child("checkbox", group);
            assert.equal(restored.data._disabled, false, "恢复显式 disabled:false 的选项");
            assert.equal(group.events.length, 3);
            assert.deepEqual(options, original, "不修改调用方数据");
        }
    }
});

test("多选组清空选项后移除旧项，重新填充时保持受控值及正常选择", (t) => {
    const h = createHarness();
    t.after(() => h.stop());
    const { CheckboxGroup } = h.source("components/ui/checkbox-group.tsx");
    const native = nativeRuntime();
    const def = native.definition("checkbox-group");
    for (const controlled of [false, true]) {
        for (const empty of [[], undefined]) {
            let previous, group;
            const props = controlled ? { value: ["goods"] } : { defaultValue: [] };
            const render = (options) => {
                const tree = h.renderComponent(CheckboxGroup, { ...props, options });
                // React 在 key 改变时创建新的原生组件，其余更新执行官方 observer。
                if (!previous || previous.key !== tree.key)
                    group = native.instance(def, tree.props);
                else native.update(def, group, tree.props);
                previous = tree;
                return group;
            };
            render(["goods", "orders"]);
            native.child("checkbox", group, 1);
            assert.equal(group.events.length, 1);
            const filled = group;
            render(["goods", "orders", "news"]);
            assert.equal(group, filled, "普通选项更新不得重置非受控选择");
            if (!controlled) assert.ok(group.data.value.includes("orders"));
            render(empty);
            assert.equal(group.data.checkboxOptions.length, 0);
            assert.equal(native.child("checkbox", group), undefined, "不存在可点击的旧项");
            assert.equal(group.events.length, 0, "清空选项本身不向业务发出 change");
            render(["goods", "news"]);
            assert.equal(group.data.checkboxOptions.length, 2);
            if (controlled) assert.equal(group.data.checkboxOptions[0].checked, true);
            else assert.equal(group.data.value.length, 0, "非受控组按 defaultValue 重新初始化");
            native.child("checkbox", group, 1);
            assert.equal(group.events.length, 1);
            assert.ok(group.events[0].detail.value.includes("news"));
        }
    }
});

for (const [name, component] of [
    ["checkbox", "CheckboxGroup"],
    ["radio", "RadioGroup"],
]) {
    test(`${component} 的原生受控及非受控选项在只读时均不触发内部变化`, (t) => {
        const h = createHarness();
        t.after(() => h.stop());
        const Component = h.source(`components/ui/${name}-group.tsx`)[component];
        const native = nativeRuntime();
        const def = native.definition(name + "-group");
        for (const controlled of [false, true]) {
            for (const options of [
                ["goods"],
                [1],
                [{ label: "商品", value: "goods", disabled: false }],
            ]) {
                const initial = name === "checkbox" ? [] : "initial";
                const props = {
                    readonly: true,
                    options,
                    ...(controlled ? { value: initial } : { defaultValue: initial }),
                };
                const tree = h.renderComponent(Component, props);
                const group = native.instance(def, tree.props);
                native.child(name, group);
                assert.equal(group.events.length, 0, "原生组件不应先变化再依赖外层回调拦截");
                assert.equal(JSON.stringify(group.data.value), JSON.stringify(initial));
            }
        }
    });

    test(`${component} 使用同一 options 切换只读可锁定与恢复，保留别名和单项状态`, (t) => {
        const h = createHarness();
        t.after(() => h.stop());
        const Component = h.source(`components/ui/${name}-group.tsx`)[component];
        const native = nativeRuntime();
        const def = native.definition(name + "-group");
        const options = ["goods", "orders"];
        const props = { options, defaultValue: name === "checkbox" ? [] : "initial" };
        const unlocked = h.renderComponent(Component, props);
        assert.equal(h.renderComponent(Component, props).props.options, unlocked.props.options);
        const group = native.instance(def, unlocked.props);
        native.child(name, group);
        assert.equal(group.events.length, 1);
        const selected = JSON.stringify(group.data.value);
        native.update(def, group, h.renderComponent(Component, { ...props, readonly: true }).props);
        native.child(name, group, 1);
        assert.equal(group.events.length, 1);
        assert.equal(JSON.stringify(group.data.value), selected);
        native.update(
            def,
            group,
            h.renderComponent(Component, { ...props, readonly: false }).props,
        );
        native.child(name, group, 1);
        assert.equal(group.events.length, 2);
        assert.ok(JSON.stringify(group.data.value).includes("orders"));
        assert.deepEqual(options, ["goods", "orders"], "不修改调用方数组");

        const aliased = h.renderComponent(Component, {
            ...props,
            options: [7],
            keys: { label: "text", value: "id" },
            readonly: true,
        });
        const aliasedGroup = native.instance(def, aliased.props);
        const items = aliasedGroup.data[name === "checkbox" ? "checkboxOptions" : "radioOptions"];
        assert.equal(items[0].value, 7);
        assert.equal(items[0].label, "7");
        native.child(name, aliasedGroup);
        assert.equal(aliasedGroup.events.length, 0);

        const item = { label: "单项只读", value: "fixed", readonly: true, disabled: false };
        const single = native.instance(
            def,
            h.renderComponent(Component, { ...props, options: [item], readonly: false }).props,
        );
        native.child(name, single);
        assert.equal(single.events.length, 0);
        assert.deepEqual(item, {
            label: "单项只读",
            value: "fixed",
            readonly: true,
            disabled: false,
        });
    });
}
