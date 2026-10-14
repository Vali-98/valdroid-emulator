import typescriptEslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [{
    files: ["**/*.{ts,tsx}"],
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
        "react-hooks": reactHooks,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "error",
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];
