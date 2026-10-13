import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import a11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
    { ignores: ["src/graphql/admin/generated.ts"] },
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
        settings: {
            "jsx-a11y": {
                components: {
                    Input: "input",
                    Button: "button",
                    SelectTrigger: "button",
                    RoleSelect: "button",
                },
            },
        },
        plugins: { "react-hooks": hooks, "jsx-a11y": a11y },
        rules: {
            ...a11y.configs.recommended.rules,
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "error",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
        },
    },
);
