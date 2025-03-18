> ## WORK IN PROGRESS
> This extension is a work in progress and is not functional at the moment.

# json-typescript-validator

> A VSCode extension which allows you to use typescript types to validate JSON files.

When installed, the extension will scan any JSON file in your project, and check if it has a `$type` property at the top level. 

It will then try to find the type exported in the specified file, and use it to do error highlighting and autocomplete suggestions while you are editing the JSON file.

### Usage Example
Create the following TypeScript file: `src/test/model.ts`
```typescript
type GenericType<T> = { value: T }

export type MyType = {
    value:              number,
    arr:                number[],
    optionalProp?:      string,
    nestedObj:          { nestedVal: number },
    enumProp:           1 | 2 | boolean | "literal string",
    intersectionProp:   { nestedVal1: number } & { nestedVal2: string },
    genericProp:        GenericType<number>,
}
```
Then, create the following JSON file: `src/test/data.json`
```JSON
{
    "$type": {
        "$from": "src/test/model.ts",
        "$import": "MyType"
    },

    "value": 1234,
    "arr": [56, 78, 90, "abcd"],
    "nestedObj": { "nestedVal": 1234 },
    "enumProp": 1,
    "intersectionProp": { "nestedVal1": 1234, "nestedVal2": "abcd" },
    "genericProp": { "value": 1234 },
}
```
Using this extension would be the equivalent of renaming `src/test/data.json` to `src.test.data.ts` and rewriting it like this:
```typescript
import { MyType } from "src/test/model.ts";

const value: Mytype = {
    value: 1234,
    arr: [56, 78, 90, "abcd"],
    nestedObj: { nestedVal: 1234 },
    enumProp: 1,
    intersectionProp: { nestedVal1: 1234, nestedVal2: "abcd" },
    genericProp: { value: 1234 },
}
```

### Notes
* This extension can only validate types that extend `object` at the top-level, because the top-level object must include a `$type` property
* The file path is always relative to your workspace
* If you want to use the default export of a file, the `$import` property should be equal to `"default"`