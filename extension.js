const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let writeTimeout = null;

class MarkdownLuaMapper { 
    
    
    static createVirtualLuaContent(mdText) {
        const lines = mdText.split(/\r?\n/);
        
        const injectRegex = /\/\/%(?:\((?:[^()]+|\([^()]*\))*\)|[^\s`'"\),]+)/g;

        const processedLines = lines.map(line => {
            let match;
            injectRegex.lastIndex = 0;
            
            // empty string for sync position
            let cleanLine = ' '.repeat(line.length).split('');

            while ((match = injectRegex.exec(line)) !== null) {
                const fullMatch = match[0];
                const startIdx = match.index;

                if (fullMatch.startsWith('//%(')) {
                    // brackets case: '//%(' -> spaces, lua as is
                    // close bracket to space
                    const luaContentStart = startIdx + 4;
                    const luaContentEnd = startIdx + fullMatch.length - 1;

                    for (let i = luaContentStart; i < luaContentEnd; i++) {
                        cleanLine[i] = line[i];
                    }
                } else {
                    // non brackets caseL '//%' -> space, lua as is
                    const luaContentStart = startIdx + 3;
                    const luaContentEnd = startIdx + fullMatch.length;

                    for (let i = luaContentStart; i < luaContentEnd; i++) {
                        cleanLine[i] = line[i];
                    }
                }
            }

            return cleanLine.join('');
        });

        return processedLines.join('\n');
    }

    static isCursorInLua(document, position) {
        const lineText = document.lineAt(position.line).text;
        return lineText.includes('//%');
    }

    static getCacheUri(document) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) return null;

        const targetDir = path.join(workspaceFolder.uri.fsPath, '.git', 'lua-cache');
        
        const safeName = document.uri.fsPath.replace(/[^a-zA-Z0-9]/g, '_') + '.lua';
        const tempFilePath = path.join(targetDir, safeName);

        return {
            dir: targetDir,
            path: tempFilePath,
            uri: vscode.Uri.file(tempFilePath)
        };
    }

    static syncVirtualCache(document, virtualLuaContent) {
        return new Promise((resolve) => {
            const cache = MarkdownLuaMapper.getCacheUri(document);
            if (!cache) return resolve(null);

            if (writeTimeout) clearTimeout(writeTimeout);

            writeTimeout = setTimeout(async () => {
                try {
                    if (!fs.existsSync(cache.dir)) {
                        fs.mkdirSync(cache.dir, { recursive: true });
                    }
                    fs.writeFileSync(cache.path, virtualLuaContent, 'utf8');

                    const doc = await vscode.workspace.openTextDocument(cache.uri);
                    
                    resolve(cache.uri);
                } catch (e) {
                    resolve(null);
                }
            }, 50);
        });
    }
}

function activate(context) {
    
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        '*', 
        {
            async provideCompletionItems(document, position, token, contextProvider) {
                if (!MarkdownLuaMapper.isCursorInLua(document, position)) return undefined;

                const mdText = document.getText();
                const virtualLuaContent = MarkdownLuaMapper.createVirtualLuaContent(mdText);
                
                const fileUri = await MarkdownLuaMapper.syncVirtualCache(document, virtualLuaContent);
                if (!fileUri) return undefined;

                const completions = await vscode.commands.executeCommand(
                    'vscode.executeCompletionItemProvider',
                    fileUri,
                    position,
                    contextProvider.triggerCharacter
                );

                if (!completions || !completions.items) return undefined;

                const mappedItems = completions.items.map(rawItem => {
                    
                    //hint obj create
                    const label = typeof rawItem.label === 'string' ? rawItem.label : rawItem.label.label;
                    const item = new vscode.CompletionItem(label, rawItem.kind);
                    
                    // valuable parts
                    item.detail = rawItem.detail;
                    item.documentation = rawItem.documentation;
                    item.insertText = rawItem.insertText;
                    item.sortText = rawItem.sortText;
                    item.filterText = rawItem.filterText;

                    // range correction
                    if (rawItem.range) {
                        if (rawItem.range instanceof vscode.Range) {
                            item.range = new vscode.Range(position.line, rawItem.range.start.character, position.line, rawItem.range.end.character);
                        } else if (rawItem.range.inserting instanceof vscode.Range) {
                            item.range = new vscode.Range(position.line, rawItem.range.inserting.start.character, position.line, rawItem.range.inserting.end.character);
                            item.range.replacing = new vscode.Range(position.line, rawItem.range.replacing.start.character, position.line, rawItem.range.replacing.end.character);
                        }
                    }
                    return item;
                });

                return new vscode.CompletionList(mappedItems, true);
            }
        },
        '.', '(', ':', '@', '"', "'" 
    );

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        '*',
        {
            async provideDefinition(document, position, token) {
                if (!MarkdownLuaMapper.isCursorInLua(document, position)) return undefined;

                const mdText = document.getText();
                const virtualLuaContent = MarkdownLuaMapper.createVirtualLuaContent(mdText);
                
                const fileUri = await MarkdownLuaMapper.syncVirtualCache(document, virtualLuaContent);
                if (!fileUri) return undefined;

                const definitions = await vscode.commands.executeCommand(
                    'vscode.executeDefinitionProvider',
                    fileUri,
                    position
                );

                if (!definitions) return undefined;

                const redirectDefinition = (loc) => {
                    if (loc.uri && loc.uri.fsPath === fileUri.fsPath) {
                        return new vscode.Location(document.uri, loc.range);
                    }
                    return loc;
                };

                if (Array.isArray(definitions)) {
                    return definitions.map(loc => redirectDefinition(loc));
                } else {
                    return redirectDefinition(definitions);
                }
            }
        }
    );
        
    // cursor pos
    const cursorMoveListener = vscode.window.onDidChangeTextEditorSelection(async (e) => {
        const editor = e.textEditor;
        if (!editor) return;

        const document = editor.document;

        // 
        // if (document.languageId !== 'html' && document.languageId !== 'markdown') return;

        const position = editor.selection.active;
        const lineText = document.lineAt(position.line).text;
        
        // lagn cfg
        const config = vscode.workspace.getConfiguration('editor', document.uri);

        if (lineText.includes('//%')) {
            // cursor in, cut 'abc' completions
            // ConfigurationTarget.WorkspaceFolder - for local apply
            if (config.get('wordBasedSuggestions') !== 'off') {
                await config.update('wordBasedSuggestions', 'off', vscode.ConfigurationTarget.WorkspaceFolder);
            }
        } else {
            // cursor out -> back to matchingDocuments 'abc'
            if (config.get('wordBasedSuggestions') === 'off') {
                await config.update('wordBasedSuggestions', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
            }
        }
    });

    context.subscriptions.push(cursorMoveListener);

}

function deactivate() {
    if (writeTimeout) clearTimeout(writeTimeout);
}

module.exports = { activate, deactivate };
