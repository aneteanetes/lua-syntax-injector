# Lua MD Injector for VS Code

VS Code extension for injecting lua code inside *.md files.

## License
MIT - 

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
* 166 generations
* ~700.000 tokens spent
* 10 context-resets
* Average context size: 1-1.7m tokens
* ~12 hours of 'testing development'
* Worst descision ever

## License
MIT - Nothing is promised, use at your own risk


**Enjoy!**
