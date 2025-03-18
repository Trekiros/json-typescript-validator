import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("json-typescript-validator");
    context.subscriptions.push(diagnosticCollection);

	vscode.workspace.onDidOpenTextDocument(validateJson);
	vscode.workspace.onDidSaveTextDocument(validateJson);

	async function validateJson(document: vscode.TextDocument) {
		if (document.languageId !== "json") return;

		diagnosticCollection.clear();

		const text = document.getText()

		let json;
		try {
			json = JSON.parse(text);
		} catch (error) {
			vscode.window.showErrorMessage(`Error parsing JSON: ${error}`);
			return;
		}

		// Ensure JSON has a $type field, otherwise skip validation on this file
		if (
			(typeof json !== "object")
		 || (typeof json["$type"] !== "object")
		 || (typeof json["$type"]["$from"] !== "string")
		 || (typeof json["$type"]["$import"] !== "string")
		) {
			return;
		}

		type ValidatableType = { $type: { $from: string, $import: string } } & object;
		const { $type, ...jsonContent } = json as ValidatableType;

		const tsFilePath = path.join(
			vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "",
			$type.$from
		);
		const typeName = $type.$import;

		if (!fs.existsSync(tsFilePath)) {
			vscode.window.showErrorMessage(`Type file not found: ${tsFilePath}`);
			return;
		}

		// Convert JSON to TypeScript syntax
		const jsonTsCode = 
			`import { ${typeName} } from "${$type.$from}";\n`
		  + `const data: ${typeName} & { $type: { $from: string, $import: string } } = \n`
		  + text;

		// Generate a temporary TS file for type checking
		const tempTsFilePath = path.join(
			vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", 
			"temp-validation.ts"
		);

		fs.writeFileSync(tempTsFilePath, jsonTsCode);

		// Run TypeScript compiler on the temporary file
		const program = ts.createProgram([tempTsFilePath], { noEmit: true });
		const diagnostics = ts.getPreEmitDiagnostics(program)
			.filter(diag => diag.code !== 5097) // Ignore the error that says you can't import typescript files

		const jsonDiagnostics: vscode.Diagnostic[] = [];
		for (const diag of diagnostics) {
			const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");

			if (diag.file && !!diag.start && !!diag.length) {
				const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);

				// Map TypeScript error location back to the JSON file (just remove 2 lines which represents the typescript code added to the json)
				const startPosition = new vscode.Position(line - 2, character);
				const endPosition = new vscode.Position(line - 2, character + diag.length)

				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(startPosition, endPosition),
					message,
					vscode.DiagnosticSeverity.Error
				);
				jsonDiagnostics.push(diagnostic);
			}
		}

		// Apply diagnostics to the JSON file
		diagnosticCollection.set(document.uri, jsonDiagnostics);

		// Cleanup temporary file
		fs.unlinkSync(tempTsFilePath);
		fs.unlinkSync(path.join(vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", "temp-validation.js"))
		fs.unlinkSync(path.join(vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", "temp-validation.js.map"))
	}
}

export function deactivate() {}
