import { MyType } from "./model.ts";
export const data: MyType & { $type: { $from: string, $import: string } } = 
{
    "$type": {
        "$from": "./model.ts",
        "$import": "MyType"
    },
    "value": 1234,
    "arr": [56, 78, 90, "abcd"],
    "enumProp": 1,

    "nestedObj": {
        "nestedVal": 1234
    },

    "intersectionType": {
        "nestedVal1": 1234,
        "nestedVal2": "abcd"
    }
}