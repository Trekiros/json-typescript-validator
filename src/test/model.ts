export type MyType = {
    value: number,
    
    arr: number[],
    
    optionalProp?: string,
    
    enumProp: 1 | 2 | boolean | "literal string",

    nestedObj: {
        nestedVal: number,
    },

    intersectionType: {
        nestedVal1: number,
    } & {
        nestedVal2: string,
    },
}