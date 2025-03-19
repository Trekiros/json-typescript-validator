import * as vscode from "vscode"
import * as ts from "typescript"
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
    wrapFile(document, ({ program, tempTsFilePath }) => {
        const diagnostics = ts.getPreEmitDiagnostics(program)
            .filter(diag => diag.code !== 5097) // Ignore the error that says you can't import typescript files

        const jsonDiagnostics: vscode.Diagnostic[] = []
        for (const diag of diagnostics) {
            if (diag.file && !!diag.start && !!diag.length) {
                const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start)
                const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n")

                if (line < 2) {
                    vscode.window.showErrorMessage("Error in $type: " + message + '\n' + tempTsFilePath)
                } else {
                    // Map TypeScript error location back to the JSON file (just remove 2 lines which represents the typescript code added to the json)
                    const startPosition = new vscode.Position(line - 2, character)
                    const endPosition = new vscode.Position(line - 2, character + diag.length)
    
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(startPosition, endPosition),
                        message,
                        vscode.DiagnosticSeverity.Error
                    );
                    jsonDiagnostics.push(diagnostic)
                }
            }
        }

        // Apply diagnostics to the JSON file
        diagnosticCollection.clear()
        diagnosticCollection.set(document.uri, jsonDiagnostics)
    })
}