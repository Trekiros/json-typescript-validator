import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient|undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
	// TODO: switch from just displaying error notifications, to acting as a proper language server, that way there will be error highlighting & autocomplete suggestions
	/*let serverModule = context.asAbsolutePath(path.join("server", "server.js"));
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc },
    };

    let clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "json" }],
    };

    client = new LanguageClient("jsonTypescriptValidator", "JSON TypeScript Validator", serverOptions, clientOptions);
	client.start();
    context.subscriptions.push({ dispose: () => client?.stop() });*/


    vscode.workspace.onDidOpenTextDocument(validateJson);
    vscode.workspace.onDidSaveTextDocument(validateJson);

    async function validateJson(document: vscode.TextDocument) {
        if (document.languageId !== "json") return;

        try {
            const json = JSON.parse(document.getText());

            // Ensure JSON has a $type field, otherwise skip validation on this file
            if (
                (typeof json !== "object")
             || (typeof json["$type"] !== "object")
             || ( typeof json["$type"]["$from"] !== "string")
             || (typeof json["$type"]["$import"] !== "string")
            ) {
                return;
            }

            type ValidatableType = {
                $type: { 
                    $from: string,
                    $import: string,
                },
            } & object

            const { $type, ...jsonContent } = json as ValidatableType;

            const tsFilePath = path.join(vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", $type.$from);
            const typeName = $type.$import;

            if (!fs.existsSync(tsFilePath)) {
                vscode.window.showErrorMessage(`Type file not found: ${tsFilePath}`);
                return;
            }

            // Load TypeScript file and compile
            const program = ts.createProgram([tsFilePath], { noEmit: true });
            const checker = program.getTypeChecker();

            const sourceFile = program.getSourceFile(tsFilePath);
            if (!sourceFile) {
                vscode.window.showErrorMessage(`Could not load TypeScript file: ${$type.$from}`);
                return;
            }

            // Find the type definition
            let foundType: ts.Type | undefined;
            ts.forEachChild(sourceFile, node => {
                if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
                    foundType = checker.getTypeAtLocation(node);
                }
            });

            if (!foundType) {
                vscode.window.showErrorMessage(`Type ${typeName} not found in ${$type.$from}`);
                return;
            }

            // Validate JSON structure against TypeScript type
            const errors = validateAgainstType(jsonContent, foundType, checker);

            if (errors.length > 0) {
                vscode.window.showErrorMessage(`Validation failed:\n${errors.join("\n\n\r")}`);
            } else {
                vscode.window.showInformationMessage(`Validation successful for ${document.fileName}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error parsing JSON: ${error}`);
        }
    }

    function validateAgainstType(json: any, tsType: ts.Type, checker: ts.TypeChecker): string[] {
        let errors: string[] = [];

        if (!tsType.isClassOrInterface() && tsType.getFlags() !== ts.TypeFlags.Object) {
            errors.push("Only object types are supported.");
            return errors;
        }

        const properties = tsType.getProperties();
        for (const prop of properties) {
            const propName = prop.getName();
            if (!(propName in json)) {
				if (!(prop.flags & ts.SymbolFlags.Optional)) {
					errors.push(`Missing property: ${propName}`);
				}

                continue;
            }

			
            const expectedType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);            
			const actualValue = json[propName];

			const nestedErrors = matchesType(propName, actualValue, expectedType, checker)
			errors.push(...nestedErrors)
        }

        return errors;
    }

    function matchesType(path: string, value: any, expectedType: ts.Type, checker: ts.TypeChecker): string[] {
		if (expectedType.flags & ts.TypeFlags.Any) return [];
		if (expectedType.flags & ts.TypeFlags.Never) return (value === undefined) ? [] : [`Type mismatch (${path}): expected never, got ${typeof value}`]
		if (expectedType.flags & ts.TypeFlags.Null) return (value === null) ? [] : [`Type mismatch (${path}): expected null, got ${typeof value}`]
		if (expectedType.flags & ts.TypeFlags.Undefined) return (value === undefined) ? [] : [`Type mismatch (${path}): expected null, got ${typeof value}`]

		if (expectedType.isUnion()) {
			const nestedErrors = expectedType.types.map(type => matchesType(path, value, type, checker))

			if (!nestedErrors.find(errors => (errors.length === 0))) return [`Type mismatch (${path}): none of the options in the union type match the value ${value}`]
			return []
		}

		if (expectedType.isIntersection()) {
			const nestedErrors = ([] as string[]).concat(...expectedType.types.map(type => matchesType(path, value, type, checker)))

			return nestedErrors
		}
		
		if (expectedType.flags & ts.TypeFlags.Object) {
			// TODO: this could be an array, or a lambda function type
			const objectType = expectedType as ts.ObjectType
			if (objectType.objectFlags & ts.ObjectFlags.EvolvingArray) {
				// TODO (this is a regular array, e.g. number[])
			}
			if (objectType.objectFlags & ts.ObjectFlags.ArrayLiteral) {
				// TODO (this is a tuple, e.g. [number, string])
			}
			
			let errors: string[] = [];

			const properties = expectedType.getProperties();
			for (const prop of properties) {
				const propName = prop.getName();
				const propPath = path + "." + propName
				if (!(propName in value)) {
					if (!(prop.flags & ts.SymbolFlags.Optional)) {
						errors.push(`Missing property: ${propPath}`);
					}
	
					continue;
				}
	
				const expectedType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);
				const actualValue = value[propName];
	
				const nestedErrors = matchesType(propPath, actualValue, expectedType, checker)
				errors.push(...nestedErrors)
			}

			return errors
		}

		if (expectedType.isNumberLiteral()) {
			if (typeof value !== "number") return [`Type mismatch (${path}): expected ${expectedType.value}, got ${typeof value}`]
			return (value === expectedType.value) ? [] : [`Type mismatch (${path}): expected ${expectedType.value}, got ${value}`]
		}

		if (expectedType.isStringLiteral()) {
			if (typeof value !== "string") return [`Type mismatch (${path}): expected ${expectedType.value}, got ${typeof value}`]
			return (value === expectedType.value) ? [] : [`Type mismatch (${path}): expected ${expectedType.value}, got ${value}`]
		}

        if (expectedType.flags & ts.TypeFlags.Number) return (typeof value === "number") ? [] : [`Type mismatch (${path}): expected number, got ${typeof value}`];
        if (expectedType.flags & ts.TypeFlags.String) return (typeof value === "string") ? [] : [`Type mismatch (${path}): expected string, got ${typeof value}`];
        if (expectedType.flags & ts.TypeFlags.Boolean) return (typeof value === "boolean") ? [] : [`Type mismatch (${path}): expected boolean, got ${typeof value}`];

        return [];
    }
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}