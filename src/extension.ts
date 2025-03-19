import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
	// Register IntelliSense completion provider to provide autocomplete suggestions
	context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "json", pattern: "**/*.json" },
            new JsonCompletionProvider(),
			
			// Triggering characters
            '{', '.', '"', " "
        )
    );

	// Register diagnostics collection to provide error highlighting
    diagnosticCollection = vscode.languages.createDiagnosticCollection("json-typescript-validator");
    context.subscriptions.push(diagnosticCollection);

	// Register onEdit listeners to edit the diagnostics collection
	vscode.workspace.onDidOpenTextDocument(validateJson);
	vscode.workspace.onDidChangeTextDocument(e => validateJson(e.document));
	vscode.workspace.onDidSaveTextDocument(validateJson);
}

export function deactivate() {}

async function validateJson(document: vscode.TextDocument) {
	wrapFile(document, ({ program }) => {
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
	})
}

let latest = 0;

function extractTypeProp(text: string) {
    const match = text.match(/"\$type"\s*:\s*{\s*"\$from"\s*:\s*"([^"]+)"\s*,\s*"\$import"\s*:\s*"([^"]+)"/);
    if (!match) return null;

    return {
        $from: match[1],  // Extracts the TypeScript file path
        $import: match[2], // Extracts the TypeScript type name
    };
}

async function wrapFile(document: vscode.TextDocument, callback: (args: {
	program: ts.Program,
	tempTsFilePath: string,
}) => any) {
	const start = Date.now()
	latest = start

	if (document.languageId !== "json") return;

	diagnosticCollection.clear();

	const text = document.getText()
	const $type = extractTypeProp(text)

	if (!$type) return;

	// Convert JSON to TypeScript syntax
	const jsonTsCode = 
		`import { ${$type.$import} } from "${$type.$from}";\n`
	  + `export const data: ${$type.$import} & { $type: { $from: string, $import: string } } = \n`
	  + text;

	// Generate a temporary TS file for type checking
	const tempTsFilePath = path.join(
		vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", 
		"temp-validation.ts"
	);

	// vscode runs this function with every keystroke, but due to the I/O operations, 
	// and the fact that typescript needs a bit of time to register and index the file,
	// it often takes longer to execute than the time between two keystrokes
	// This check verifies that we're in the latest call of this function, 
	// So if we aren't, then we stop the function before getting to the part that is slowest.
	if (start !== latest) return;
	await new Promise(res => fs.writeFile(tempTsFilePath, jsonTsCode, {}, res));
	if (start !== latest) return;

	// Run TypeScript compiler on the temporary file
	try {
		const importedFilePath = path.join(
			vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", 
			$type.$from
		)

		const program = ts.createProgram([tempTsFilePath, importedFilePath], { noEmit: true });
		await callback({ program, tempTsFilePath })
	} catch (e) {
		vscode.window.showErrorMessage(`Error: ${e}`);
	}

	// Cleanup temporary file
	try {
		fs.unlinkSync(tempTsFilePath);
		fs.unlinkSync(path.join(vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", "temp-validation.js"))
		fs.unlinkSync(path.join(vscode.workspace.workspaceFolders?.[0].uri.path.substring(1) || "", "temp-validation.js.map"))
	} catch (e) {
		// Do nothing
	}
}

class JsonCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
		let result: vscode.CompletionItem[] = []
		await wrapFile(document, async ({ program, tempTsFilePath }) => {
			result = (await getCompletionsFromVSCode(tempTsFilePath, position))
				.filter(item => (
					   (item.kind !== vscode.CompletionItemKind.Variable)
					&& (item.kind !== vscode.CompletionItemKind.Keyword)
					&& (item.kind !== vscode.CompletionItemKind.Function)
					&& (item.kind !== vscode.CompletionItemKind.Class)
					&& (item.kind !== vscode.CompletionItemKind.Module)
					&& (item.kind !== vscode.CompletionItemKind.Snippet)
					&& (item.label !== "chrome")
				))
				.map(item => ({
					label: item.label,
					insertText: (item.kind as any === "Property") ? (
						'"' + (
							(!item.insertText) ? ""
						  : (typeof item.insertText === "string") ? item.insertText 
						  : item.insertText.value
						).replaceAll('"', '\\"') + '"'
					) : (
						item.insertText
					),
					kind: (item.kind as any === "Property") ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Text
				}))
		})
		vscode.window.showErrorMessage("Test vvvv: (" + result.length + ") " + JSON.stringify(result, null, 2))

		return structuredClone(result)
    }
}

async function getCompletionsFromVSCode(tempTsFilePath: string, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const uri = vscode.Uri.file(tempTsFilePath);
	const offsetPosition = new vscode.Position(position.line + 2, position.character)

	// Force vscode's typescript language server to evaluate the temporary file
	// TODO: this doesn't work yet, the user still needs to manually open the file for typescript to evaluate the file
	await vscode.workspace.openTextDocument(uri)
	await vscode.languages.getDiagnostics(uri)

    // Ask VS Code to fetch completions
    const completionList = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        uri,
        offsetPosition
    );

    if (!completionList) {
        console.warn("No completions received from VS Code.");
        return [];
    }

    return completionList.items;
}