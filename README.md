# Lua MD Injector for VS Code

VS Code extension for injecting lua code inside *.md files.

## License
MIT - Nothing is promised, use at your own risk

## Common

You can write Lua code inside md files by `//%` sequence: 

> //%lua md-content
> //%(lua) md-content

## Features

* Autocomplete lua code
* Go to definition
* Scan other Lua files inside directory

## Requirements

Tested only with `sumneko's` lua server.

## Known Issues

Unfortunately, lua servers need physical files for link with other files inside solution. By design, extension create temp file inside `.git` directory. 

## Development

95% vibecoded:
* 197 generations
* ~800.000 tokens spent
* 25 context-resets
* Average context size: 1m-1.7m tokens
* ~16 hours of 'testing development'
* Worst descision ever

> You can track generations count by version postfix.

**Enjoy!**
