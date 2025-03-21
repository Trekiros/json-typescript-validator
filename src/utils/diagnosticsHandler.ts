import * as vscode from "vscode"
import { wrapFile } from "./fileWrapper"

let diagnosticCollection: vscode.DiagnosticCollection

export function initializeDiagnosticsHandler(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("json-typescript-validator")
    context.subscriptions.push(diagnosticCollection)

	vscode.workspace.onDidOpenTextDocument(validateJson)
	vscode.workspace.onDidChangeTextDocument(e => validateJson(e.document))
	vscode.workspace.onDidSaveTextDocument(validateJson)
}

async function validateJson(document: vscode.TextDocument) {
    wrapFile(document, (tempTsFilePath) => {
        let diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(tempTsFilePath))

        const jsonDiagnostics: vscode.Diagnostic[] = []
        for (const diag of diagnostics) {
            const { start, end } = diag.range

            if (start.line < 2) {
                vscode.window.showErrorMessage("Error in $type: " + diag.message + '\n' + tempTsFilePath)
            } else {
                // Map TypeScript error location back to the JSON file (just remove 2 lines which represents the typescript code added to the json)
                const startPosition = new vscode.Position(start.line - 2, start.character)
                const endPosition = new vscode.Position(end.line - 2, end.character)

                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(startPosition, endPosition),
                    diag.message,
                    vscode.DiagnosticSeverity.Error
                );
                jsonDiagnostics.push(diagnostic)
            }
        }

        // Apply diagnostics to the JSON file
        diagnosticCollection.set(document.uri, jsonDiagnostics)
    }, function handleUntaggedFile() {
        diagnosticCollection.clear()
    })
}
