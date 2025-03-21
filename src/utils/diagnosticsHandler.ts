import * as vscode from "vscode"
import * as ts from "typescript"
import { wrapFile } from "./fileWrapper"
import path from "path"

let diagnosticCollection: vscode.DiagnosticCollection

export function initializeDiagnosticsHandler(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection("json-typescript-validator")
    context.subscriptions.push(diagnosticCollection)

	vscode.workspace.onDidOpenTextDocument(validateJson)
	vscode.workspace.onDidChangeTextDocument(e => validateJson(e.document))
	vscode.workspace.onDidSaveTextDocument(validateJson)
}


async function validateJson(document: vscode.TextDocument) {
    console.log("json-typescript-validator - validating json")

    wrapFile(document, (tempTsFilePath) => {
        console.log("json-typescript-validator - file wrapped")

        const program = createProgram(tempTsFilePath)
        if (!program) return;
        
        console.log("json-typescript-validator - typescript program created")

        const sourceFile = program.getSourceFile(tempTsFilePath)
        let diagnostics = ts.getPreEmitDiagnostics(program, sourceFile)
            .filter(diag => (diag.code !== 5097)) // This error just says that you can't import ".ts" files so it's useless to display

        console.log(`json-typescript-validator - retrieved ${diagnostics.length} typescript diagnostics`)

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
                    
                    console.log(`json-typescript-validator - diagnostic saved`, diagnostic)
                }
            } else {
                console.log(`json-typescript-validator - diagnostic skipped`, diag)
            }
        }

        // Apply diagnostics to the JSON file
        diagnosticCollection.set(document.uri, jsonDiagnostics)
        console.log(`json-typescript-validator - diagnostics collection updated`)
    }, function handleUntaggedFile() {
        diagnosticCollection.clear()
        console.log(`json-typescript-validator - diagnostics collection cleared`)
    })
}

// This creates a TypeScript program which re-uses the user's tsconfig, to ensure that things like module resolution behave in a consistent and predictable way
function createProgram(uri: string) {
    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || './'
    const configPath = ts.findConfigFile(workspacePath, ts.sys.fileExists, "tsconfig.json")
    
    if (!configPath) {
        vscode.window.showErrorMessage("Could not find tsconfig.json in workspace.")
        return
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

    if (configFile.error) {
        vscode.window.showErrorMessage("Error reading tsconfig.json")
        return
    }

    const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath))
    const program = ts.createProgram([uri], parsedConfig.options)

    return program
}