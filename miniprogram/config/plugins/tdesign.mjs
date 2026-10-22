import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const components = [
    "title",
    "text",
    "paragraph",
    "button",
    "input",
    "tag",
    "empty",
    "dialog",
    "popup",
    "picker",
    "picker-item",
    "switch",
    "checkbox-group",
    "radio-group",
    "textarea",
    "cell",
    "cell-group",
    "divider",
    "tabs",
    "tab-panel",
    "tab-bar",
    "tab-bar-item",
];
// wx://form-field 行为注入的属性不一定包含在官方 props.js 中。
const formFieldComponents = new Set([
    "input",
    "textarea",
    "switch",
    "checkbox-group",
    "radio-group",
]);
const eventNames = {
    title: ["onExpand"],
    text: ["onExpand", "onCopy"],
    paragraph: ["onExpand"],
    tabs: ["onChange", "onClick", "onScroll", "onError"],
    "tab-bar": ["onChange"],
    switch: ["onChange"],
    "checkbox-group": ["onChange"],
    "radio-group": ["onChange"],
    textarea: [
        "onChange",
        "onFocus",
        "onBlur",
        "onEnter",
        "onLineChange",
        "onKeyboardheightchange",
    ],
    cell: ["onClick"],
    tag: ["onClick", "onClose"],
    button: [
        "onTap",
        "onGetuserinfo",
        "onContact",
        "onGetphonenumber",
        "onGetrealtimephonenumber",
        "onCreateliveactivity",
        "onError",
        "onOpensetting",
        "onLaunchapp",
        "onChooseavatar",
        "onAgreeprivacyauthorization",
    ],
    input: [
        "onChange",
        "onClear",
        "onFocus",
        "onBlur",
        "onEnter",
        "onKeyboardheightchange",
        "onNicknamereview",
    ],
    dialog: ["onConfirm", "onCancel", "onClose", "onOverlayClick"],
    popup: ["onVisibleChange"],
    picker: ["onConfirm", "onCancel", "onChange", "onClose", "onVisibleChange", "onPick"],
};
class NativeAttributes extends Set {
    add(name) {
        // JSX 收集器补充 camelCase 属性时，保持单一的微信原生绑定名。
        const attribute =
            name === "className"
                ? "class"
                : name.startsWith("on") || name.startsWith("bind")
                  ? name
                  : name.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase());
        return super.add(attribute);
    }
}
function packageRoot(root) {
    return path.dirname(
        createRequire(path.join(root, "package.json")).resolve("tdesign-miniprogram/package.json"),
    );
}
function componentProperties(root, name) {
    const source = ts.createSourceFile(
        "props.js",
        fs.readFileSync(path.join(packageRoot(root), "miniprogram_dist", name, "props.js"), "utf8"),
        ts.ScriptTarget.Latest,
        true,
    );
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                declaration.name.getText(source) === "props" &&
                declaration.initializer &&
                ts.isObjectLiteralExpression(declaration.initializer)
            )
                return declaration.initializer.properties;
        }
    }
    throw new Error(`无法读取 TDesign ${name} 的属性定义`);
}

function templateLiteral(node) {
    // HTML 实体在后续 hover-class/placeholder-class 转换中会被解码。
    // 用单引号生成 JS 字符串，字符串内部双引号保留为转义，避免闭合 WXML 属性。
    const transformed = ts.transform(node, [
        (context) => {
            const visit = (child) =>
                ts.isStringLiteral(child)
                    ? ts.factory.createStringLiteral(child.text, true)
                    : ts.visitEachChild(child, visit, context);
            return (root) => ts.visitNode(root, visit);
        },
    ]);
    try {
        return ts
            .createPrinter({ removeComments: true })
            .printNode(ts.EmitHint.Expression, transformed.transformed[0], node.getSourceFile())
            .replaceAll('"', "\\x22");
    } finally {
        transformed.dispose();
    }
}

function componentDefaults(root, name) {
    const defaults = {
        customStyle: "''",
        ariaLabel: "''",
        ariaRole: "''",
        ariaLabelledby: "''",
        ariaDescribedby: "''",
        ariaHidden: "false",
        ariaBusy: "false",
    };
    if (formFieldComponents.has(name)) defaults.name = "''";
    const typeDefaults = {
        String: "''",
        Number: "0",
        Boolean: "false",
        Array: "[]",
        Object: "null",
    };
    for (const prop of componentProperties(root, name)) {
        const settings = Object.fromEntries(
            prop.initializer.properties.map((setting) => [
                setting.name.getText(),
                setting.initializer,
            ]),
        );
        // 保留官方 null 哨兵和所有显式默认值；void 0 使用微信对应类型的默认值。
        const value =
            settings.value && !ts.isVoidExpression(settings.value)
                ? ts.isObjectLiteralExpression(settings.value) &&
                  settings.value.properties.length === 0
                    ? "xs.d()"
                    : templateLiteral(settings.value)
                : typeDefaults[settings.type?.getText()];
        if (value !== undefined) defaults[prop.name.getText()] = value;
    }
    return Object.fromEntries(
        Object.entries(defaults).map(([name, value]) => [
            name.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase()),
            value,
        ]),
    );
}
// 当前 Vite 原生模板对包外 WXS/Include 路径处理不完整，构建前准备源码内资源。
export function prepareTDesign(root) {
    const source = path.join(packageRoot(root), "miniprogram_dist");
    const target = path.join(root, "src/native/tdesign");
    const writeChanged = (file, contents) => {
        const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
        if (fs.existsSync(file) && fs.readFileSync(file).equals(data)) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    };
    // 相同内容不重写，避免静态检查加载配置时触发正在运行的 watch。
    for (const file of fs.readdirSync(source, { recursive: true })) {
        const input = path.join(source, file);
        if (!fs.statSync(input).isFile()) continue;
        let contents = fs.readFileSync(input);
        // Taro 4.2.1 把 WXML 动态 src 当作文件读取；产物中恢复原表达式。
        if (file.endsWith(".wxml")) {
            contents = Buffer.from(
                contents
                    .toString("utf8")
                    .replace(/\bsrc=(['"])(.*?)\1/g, (match, quote, value) =>
                        value.includes("{{")
                            ? `src=${quote}https://tdesign-build.invalid/${Buffer.from(value).toString("base64url")}${quote}`
                            : match,
                    ),
            );
        }
        writeChanged(path.join(target, file), contents);
    }
}
export default function registerTDesign(ctx) {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    ctx.modifyComponentConfig(({ componentConfig }) => {
        for (const name of components) {
            const attrs = new NativeAttributes([
                "class",
                "style",
                "custom-style",
                "t-class",
                // SuperComponent 在运行时补充，未包含在各组件的 props.js 中。
                "aria-label",
                "aria-role",
                "aria-hidden",
                "aria-labelledby",
                "aria-describedby",
                "aria-busy",
                ...(eventNames[name] ?? []),
            ]);
            // 原生组件的 spread 属性不会被 Vite JSX 收集器展开，显式注册发布包属性。
            for (const prop of componentProperties(root, name)) {
                attrs.add(prop.name.getText());
            }
            if (formFieldComponents.has(name)) attrs.add("name");
            componentConfig.thirdPartyComponents.set("t-" + name, attrs);
        }
    });
    ctx.modifyViteConfig(({ viteConfig, viteCompilerContext }) => {
        viteConfig.plugins.push(createTDesignNativeOutput(viteCompilerContext));
        const defaults = Object.fromEntries(
            components.map((name) => ["t-" + name, componentDefaults(root, name)]),
        );
        // 使用 Taro 的 WXS 默认值管线，不在 generateBundle 改写 WXML 表达式。
        // 空对象由 xs.d() 返回，WXML 编译器不接受三元表达式中的空对象字面量。
        const template = viteCompilerContext.taroConfig.template;
        template.mergeThirdPartyComponents(defaults);
        const buildAttributes = template.buildThirdPartyAttr;
        template.buildThirdPartyAttr = function (attrs, patcher) {
            if (!(attrs instanceof NativeAttributes) || !attrs.has("style")) {
                return buildAttributes.call(this, attrs, patcher);
            }
            // Taro 对 style 的特殊分支绕过默认值配置，且运行时使用缩写 st。
            // 在属性生成时处理缺省/清空，避免 null 传给 TD 的 String 属性。
            const remaining = new Set(attrs);
            remaining.delete("style");
            return buildAttributes.call(this, remaining, patcher) + ` style="{{i.st||''}}"`;
        };
    });
}

// 原生入口统一交给 Taro 生成，首轮和 watch 共用同一份 isGenerated 状态。
function createTDesignNativeOutput(compiler) {
    const nativeRoot = path.join(compiler.sourceDir, "native/tdesign") + path.sep;
    const isTDesign = (component) => component.scriptPath.startsWith(nativeRoot);
    const assets = new Map();
    const conflicts = new Set();
    const generate = compiler.generateNativeComponent;
    compiler.generateNativeComponent = function (context, component, ...args) {
        if (!isTDesign(component)) return generate.call(this, context, component, ...args);
        const output = Object.create(context);
        output.emitFile = (file) => {
            if (file.type === "chunk") {
                // buildStart 中的原生组件是独立入口，不依赖 app load 再次执行。
                const entry = { ...file };
                delete entry.implicitlyLoadedAfterOneOf;
                return context.emitFile(entry);
            }
            if (file.type !== "asset" || !file.fileName?.startsWith("native/tdesign/")) {
                return context.emitFile(file);
            }
            const source = Buffer.from(file.source);
            const previous = assets.get(file.fileName);
            if (previous) {
                if (!previous.source.equals(source)) {
                    conflicts.add(file.fileName);
                }
                return previous.reference;
            }
            const reference = context.emitFile(file);
            assets.set(file.fileName, { source, reference });
            return reference;
        };
        return generate.call(this, output, component, ...args);
    };
    return {
        name: "tdesign-native-output",
        enforce: "pre",
        buildStart() {
            assets.clear();
            conflicts.clear();
            for (const component of compiler.nativeComponents.values()) {
                if (!isTDesign(component)) continue;
                component.isGenerated = false;
                this.addWatchFile(component.configPath);
                compiler.generateNativeComponent(this, component);
            }
        },
        buildEnd(error) {
            // miniTemplateLoader 的回调是 async，在构建 hook 内传播内容冲突。
            if (!error && conflicts.size) {
                this.error(`TDesign 同名资源内容不一致：${[...conflicts].join("、")}`);
            }
        },
    };
}

/** @returns {import("vite").Plugin} */
export function createTDesignCompatibility(
    root = fileURLToPath(new URL("../../", import.meta.url)),
) {
    const themeFile = path.join(
        packageRoot(root),
        "miniprogram_dist/common/style/theme/_index.wxss",
    );
    return {
        name: "tdesign-native-compatibility",
        enforce: "pre",
        buildStart() {
            this.addWatchFile(themeFile);
        },
        transform(code, id) {
            if (!id.includes("/native/tdesign/") || !id.endsWith("?isNativeScript=comp")) return;
            // 首轮仍可能先由 Taro load 返回入口，将其假 SCSS 导入转入同一 CSS 管线。
            return {
                code: code.replace(/\.scss\?isNativeStyle=true/g, ".css?tdesign-native-style"),
                map: null,
            };
        },
        resolveId(id) {
            if (id.endsWith(".css?tdesign-native-style")) return id;
        },
        load(id) {
            if (id.includes("/native/tdesign/") && id.endsWith("?isNativeScript=comp")) {
                // Taro native-support 在首次 buildEnd 后清空上下文，后续失效的入口
                // 也必须保持同一组 JS/CSS 导入，不能回退为读取空查询模块。
                const entry = id.replace(/\.js\?isNativeScript=comp$/, "");
                return `import ${JSON.stringify(entry + ".js")};\nimport ${JSON.stringify(entry + ".css?tdesign-native-style")};`;
            }
            if (!id.endsWith(".css?tdesign-native-style")) return;
            const expand = (file) => {
                this.addWatchFile(file);
                return fs
                    .readFileSync(file, "utf8")
                    .replace(/@import\s+['"]([^'"]+)['"];?/g, (_match, relative) =>
                        expand(path.resolve(path.dirname(file), relative)),
                    );
            };
            return expand(id.replace(/\.css\?tdesign-native-style$/, ".wxss"));
        },
        generateBundle: {
            order: "post",
            handler(_options, bundle) {
                // Vite 会合并内容相同的 CSS（Title/Text/Paragraph 即如此）。
                // Taro 随后反复改写该 asset 的 fileName，只留下最后一个原生组件的 WXSS。
                // 微信按组件同名加载样式，为每个原生入口保留自己的样式文件。
                const styles = new Set(Object.values(bundle).map((file) => file.fileName));
                for (const file of Object.values(bundle)) {
                    if (file.type !== "chunk" || !file.fileName.startsWith("native/tdesign/"))
                        continue;
                    const name = file.fileName.replace(/\.js$/, ".wxss");
                    if (styles.has(name)) continue;
                    const imported = [...(file.viteMetadata?.importedCss ?? [])]
                        .map((id) => bundle[id])
                        .filter((asset) => asset?.type === "asset");
                    if (!imported.length) continue;
                    this.emitFile({
                        type: "asset",
                        fileName: name,
                        source: imported.map((asset) => asset.source).join("\n"),
                    });
                    styles.add(name);
                }
                for (const file of Object.values(bundle)) {
                    if (file.type !== "asset" || !file.fileName.endsWith(".wxml")) continue;
                    const source =
                        typeof file.source === "string"
                            ? file.source
                            : Buffer.from(file.source).toString("utf8");
                    file.source = source.replace(
                        /https:\/\/tdesign-build\.invalid\/([A-Za-z0-9_-]+)/g,
                        (_match, encoded) => Buffer.from(encoded, "base64url").toString("utf8"),
                    );
                }
            },
        },
        writeBundle: {
            order: "pre",
            sequential: true,
            handler(options) {
                // Tailwind watch 会重建单入口样式，也会重分配 generateBundle 新增的主题。
                // 在样式管线落盘后独立接入，早于后续 writeBundle 的 Windows 同步。
                const output = options.dir;
                if (!output) throw new Error("缺少小程序输出目录，无法接入 TDesign 主题");
                const app = path.join(output, "app.wxss");
                const source = fs.readFileSync(app, "utf8");
                const statement = '@import "./tdesign-theme.wxss";';
                fs.writeFileSync(
                    path.join(output, "tdesign-theme.wxss"),
                    fs.readFileSync(themeFile),
                );
                fs.writeFileSync(app, statement + "\n" + source.replace(statement, ""));
            },
        },
    };
}
