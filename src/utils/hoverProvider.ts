import * as vscode from 'vscode'
import { wrapFile } from './fileWrapper';

export function initializeHoverProvider(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider("json", {
            async provideHover(document, position, token) {
                return await getHoverInfo(document, position, token)
            }
        })
    )
}

async function getHoverInfo(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover|null> {
    let result: vscode.Hover|null = null
    
    await wrapFile(document, async (tempFileUri) => {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            vscode.Uri.file(tempFileUri),
            new vscode.Position(position.line + 2, position.character)
        )
    
        if (hovers.length) result = hovers[0]
    })

    return result
}