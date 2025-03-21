import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

let latest = 0

type TypeTag = {
    $from: string,
    $import: string,
}

export async function wrapFile(
    document: vscode.TextDocument, 
    callback: (tempFileUri: string) => any,
    notTaggedCallback?: () => any,
) {
    if (document.languageId !== "json") return

    const text = document.getText()
    const $type = extractTypeProp(text)

    if (!$type) {
        if (!!notTaggedCallback) await notTaggedCallback()
        return;
    }

    // Convert JSON to TypeScript syntax
    const jsonTsCode =
        `import { ${$type.$import} } from "${$type.$from}";\n`
      + `export const data: ${$type.$import} & { $type: { $from: string, $import: string } } = \n`
      + text

    // Generate a temporary TS file for type checking
    const folderUri = document.uri.fsPath.slice(0, document.uri.fsPath.lastIndexOf('\\') + 1)
    const tempTsFilePath = path.join(folderUri, "temp-validation.ts")

    // vscode runs this function with every keystroke, but due to the I/O operations, 
    // and the fact that typescript needs a bit of time to register and index the file,
    // it often takes longer to execute than the time between two keystrokes
    // This check verifies that we're in the latest call of this function, 
    // So if we aren't, then we stop the function before getting to the part that is slowest.
    const start = Date.now()
    latest = start
    await new Promise(res => fs.writeFile(tempTsFilePath, jsonTsCode, {}, res))

    if (latest !== start) return;
    await forceTypeScriptIndexing(vscode.Uri.file(tempTsFilePath))
    if (latest !== start) return;

    // Run TypeScript compiler on the temporary file
    try {
        await callback(tempTsFilePath)
    } catch (e) {
        vscode.window.showErrorMessage(`Error: ${e}`)
    }

    // Cleanup temporary file
    try {
        if (start !== latest) return;

        fs.unlinkSync(tempTsFilePath)
    } catch (e) {
        // Do nothing
    }
}

function extractTypeProp(text: string): TypeTag|null {
    const match = text.match(/"\$type"\s*:\s*{\s*"\$from"\s*:\s*"([^"]+)"\s*,\s*"\$import"\s*:\s*"([^"]+)"/)
    if (!match) return null

    return {
        $from: match[1],  // Extracts the TypeScript file path
        $import: match[2], // Extracts the TypeScript type name
    }
}

// VSCode's TypeScript instance only starts giving accurate completion items if the file is opened in an actual tab of the workspace
// This function ensures that is the case.
const alreadyOpened = new Set<string>()
async function forceTypeScriptIndexing(uri: vscode.Uri) {
    if (alreadyOpened.has(uri.fsPath)) return;

    // Check if the tab already exists
    for (const group of vscode.window.tabGroups.all) {
        const tab = group.tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === uri.fsPath);
        if (!!tab) return;
    }

    // Open document without losing focus on the current tab
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside, // Open in a new tab beside the current one
        preview: true, // Open as a preview (auto-closes when replaced)
        preserveFocus: true, // Do NOT take focus away
    })

    // Wait until the diagnostics start giving actual results
    const startTime = Date.now()
    const timeout = 2000
    while ((Date.now() - startTime < timeout) && !vscode.languages.getDiagnostics(uri).length) {
        await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Close the temporary tab
    for (const group of vscode.window.tabGroups.all) {
        const tab = group.tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === uri.fsPath);
        
        if (tab) {
            await vscode.window.tabGroups.close(tab); // Close it without switching focus
            break;
        }
    }

    // This only needs to be done once
    alreadyOpened.add(uri.fsPath)
}
