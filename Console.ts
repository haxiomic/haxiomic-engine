/**
 * Console.ts
 * 
 * HTML-like console formatting in the browser and native console in Node.js
 * 
 * - Apply formatting with HTML-like tags: `<b>bold</b>`
 * - A closing tag without a tag name can be used to close the last-open format tag `</>` so `<b>bold</>` will also work
 * - Tags are case-insensitive
 * - A double-closing tag like `<//>` will clear all active formatting
 * - Multiple tags can be combined with comma separation, `<b,i>bold-italic</>`
 * - Whitespace is not allowed in tags, so `<b >` would be ignored and printed as-is
 * - Tags can be escaped with a leading backslash: `\<b>` would be printed as-is
 * - Unknown tags are skipped and will not show up in the output
 * - For browser targets, CSS fields and colors can be used, for example: `<{color: red; font-size: 20px}>Inline CSS</>` or `<#FF0000>Red Text</#FF0000>`. These will have no affect on native consoles
 * 
 * Ported from Console.hx https://github.com/haxiomic/console.hx
 * 
 * @author haxiomic (George Corney)
 * @version 1.0.0
 * @license MIT
 */
export namespace Console {

	export let emitVerbose = false;
	export let emitDebug = true;
	export let emitLog = true;

	export enum OutputStream {
		Log,
		Warn,
		Error,
		Debug,
	}

	export enum FormatMode {
		AsciiTerminal,
		BrowserConsole,
		Disabled,
	}

	export let formatMode = determineFormatMode();

	export let logPrefix = '<b,gray>><//>';
	export let warnPrefix = '<b,yellow>><//>';
	export let errorPrefix = '<b,red>></b>';
	export let successPrefix = '<b,light_green>><//>';
	export let debugPrefix = '<b,magenta>><//>';
	export let argSeparator = ' ';

	export function log(...args: any[]) {
		if (emitLog) {
			printlnArgsFormatted([logPrefix, ...args], OutputStream.Log);
		}
	}

	export function warn(...args: any[]) {
		printlnArgsFormatted([warnPrefix, ...args], OutputStream.Warn);
	}

	export function error(...args: any[]) {
		let errorStack = new Error();
		let callerInfo = getCallerInfo(errorStack);

		if (callerInfo != null) {
			let callerPrefix = callerInfoPrefix(callerInfo);
			// print debug message
			printlnArgsFormatted([
				errorPrefix + (callerPrefix ? `<b>${callerPrefix}</b>:` : ''),
				...args
			],
				OutputStream.Error
			);
		} else {
			printlnArgsFormatted([errorPrefix, ...args], OutputStream.Error);
		}
	}

	export function success(...args: any[]) {
		printlnArgsFormatted([successPrefix, ...args], OutputStream.Log);
	}

	export function verbose(...args: any[]) {
		if (emitVerbose) {
			printlnArgsFormatted(args, OutputStream.Log);
		}
	}

	export function debug(...args: any[]) {
		if (!emitDebug) return;

		// get stack trace
		let errorStack = new Error();
		let callerInfo = getCallerInfo(errorStack);

		if (callerInfo != null) {
			let callerPrefix = callerInfoPrefix(callerInfo);
			// print debug message
			printlnArgsFormatted([
				debugPrefix + (callerPrefix ? `<b>${callerPrefix}</b>:` : ''),
				...args
			],
				OutputStream.Debug
			);
		} else {
			printlnArgsFormatted([debugPrefix, ...args], OutputStream.Debug);
		}
	}

	export function getCallerInfo(error: Error) {
		try {
			if (error.stack != null) {
				// get the line that called debug
				let lines = error.stack.split('\n');
				let line = lines[2];
				if (line == null) {
					return null;
				}
				let match = line.match(/at\s+(.*)\s+\((.*):(\d+):\d+\)/);
				let functionName = match?.[1] ?? null;
				let filepath = match?.[2] ?? null;
				let filename = filepath?.split(/[/\\]/).pop() ?? null;
				let lineNumber = match != null ? parseInt(match[3]) : null;

				return {
					functionName,
					filepath,
					filename,
					lineNumber,
				}
			} else {
				return null;
			}
		} catch {
			return null;
		}
	}

	export function callerInfoPrefix(callerInfo: ReturnType<typeof getCallerInfo>): string {
		let parts = new Array<string>();
		if (callerInfo != null) {
			if (callerInfo.filename != null) {
				parts.push(callerInfo.filename);
			}
			if (callerInfo.functionName != null) {
				parts.push(callerInfo.functionName + '()');
			}
			if (callerInfo.lineNumber != null) {
				parts.push(callerInfo.lineNumber.toString());
			}
		}
		return parts.join(':');
	}

	export function examine(...args: any[]) {
		// use node's util.inspect to print objects
		for (let arg of args) {
			printlnArgsFormatted([logPrefix, arg], OutputStream.Log);
		}
	}

	export function printlnArgsFormatted(args: any[], outputStream?: OutputStream) {
		if (formatMode === FormatMode.AsciiTerminal) {
			let formatted = args.map(arg => {
				switch (typeof arg) {
					case 'string': return format(arg, formatMode).formatted;
					default: return global.require('util').inspect(arg, { depth: null, colors: true });
				}
			}).join(argSeparator);
			return println(formatted, outputStream);
		} else if (formatMode === FormatMode.BrowserConsole) {
			// here we map args by type, if string we pass through formatter, everything else we log as-is
			let formatString = '';
			let browserFormatArguments = new Array<string>();
			for (let i = 0; i < args.length; i++) {
				let arg = args[i];
				if (i > 0) {
					formatString += argSeparator;
				}
				switch (typeof arg) {
					case 'string': {
						let formatted = format(arg, formatMode);
						formatString += formatted.formatted;
						browserFormatArguments.push(...formatted.browserFormatArguments);
					} break;
					// see format specifiers
					// https://console.spec.whatwg.org/#formatting-specifiers
					// Specifier   | Purpose
					// %s          | Element which substitutes is converted to a string
					// %d or %i    | Element which substitutes is converted to an integer
					// %f          | Element which substitutes is converted to a float
					// %o          | Element is displayed with optimally useful formatting
					// %O          | Element is displayed with generic JavaScript object formatting
					// %c          | Applies provided CSS
					default: {
						formatString += '%o';
						browserFormatArguments.push(arg);
					} break;
				}
			}

			switch (outputStream) {
				case OutputStream.Log:
					console.log(formatString, ...browserFormatArguments);
					break;
				case OutputStream.Warn:
					console.warn(formatString, ...browserFormatArguments);
					break;
				case OutputStream.Error:
					console.error(formatString, ...browserFormatArguments);
					break;
				case OutputStream.Debug:
					console.debug(formatString, ...browserFormatArguments);
					break;
			}
		}
	}

	export function printlnFormatted(s = '', outputStream?: OutputStream) {
		return printlnArgsFormatted([s + '\n'], outputStream);
	}

	export function println(s = '', outputStream?: OutputStream) {
		return print(s + '\n', outputStream);
	}

	export function print(s: string = '', outputStream: OutputStream = OutputStream.Log) {
		if (formatMode == FormatMode.AsciiTerminal) {
			// check if process is defined
			let global = globalThis as any;
			if ('process' in global) {
				// write direct to stdout/stderr
				switch (outputStream) {
					case OutputStream.Log:
					case OutputStream.Debug:
						global.process.stdout.write(s);
						break;
					case OutputStream.Warn:
					case OutputStream.Error:
						global.process.stderr.write(s);
						break;
				}
			}
		} else {
			// write to console
			switch (outputStream) {
				case OutputStream.Log:
					console.log(s);
					break;
				case OutputStream.Warn:
					console.warn(s);
					break;
				case OutputStream.Error:
					console.error(s);
					break;
				case OutputStream.Debug:
					console.debug(s);
					break;
			}
		}
	}

	export function stripFormatting(s: string) {
		return format(s, FormatMode.Disabled).formatted;
	}

	const formatTagPattern = /(\\)?<(\/)?([^><{}\s]*|{[^}<>]*})>/g;
	export function format(s: string, formatMode: FormatMode) {
		s = s + '<//>';// Add a reset all to the end to prevent overflowing formatting to subsequent lines

		let activeFormatFlagStack = new Array<FormatFlag>();
		let groupedProceedingTags = new Array<Int>();
		let browserFormatArguments = new Array<string>();

		function addFlag(flag: FormatFlag, proceedingTags: Int) {
			activeFormatFlagStack.push(flag);
			groupedProceedingTags.push(proceedingTags);
		}

		function removeFlag(flag: FormatFlag) {
			let i = activeFormatFlagStack.indexOf(flag);
			if (i != -1) {
				let proceedingTags = groupedProceedingTags[i];
				// remove n tags
				activeFormatFlagStack.splice(i - proceedingTags, proceedingTags + 1);
				groupedProceedingTags.splice(i - proceedingTags, proceedingTags + 1);
			}
		}

		function resetFlags() {
			activeFormatFlagStack = [];
			groupedProceedingTags = [];
		}

		let result = s.replace(formatTagPattern, (wholeMatch, ...args) => {
			// args from 0 to 2 are the match, the escaped flag, and the open flag
			let matched = args as [string, string, string];

			let escaped = matched[0] != null;
			if (escaped) {
				return wholeMatch;
			}

			let open = matched[1] == null;
			let tags = matched[2].split(',');

			// handle </> and <//>
			if (!open && tags.length == 1) {
				if (tags[0] == '') {
					// we've got a shorthand to close the last tag: </>
					let last = activeFormatFlagStack[activeFormatFlagStack.length - 1];
					removeFlag(last);
				} else if (formatFlagFromString(tags[0]) == FormatFlag.RESET) {
					resetFlags();
				} else {
					// handle </*>
					let flag = formatFlagFromString(tags[0]);
					if (flag != null) {
						removeFlag(flag);
					}
				}
			} else {
				let proceedingTags = 0;
				for (let tag of tags) {
					let flag = formatFlagFromString(tag);
					if (flag == null) return wholeMatch; // unhandled tag, don't treat as formatting
					if (open) {
						addFlag(flag, proceedingTags);
						proceedingTags++;
					} else {
						removeFlag(flag);
					}
				}
			}

			// since format flags are cumulative, we only need to add the last item if it's an open tag
			switch (formatMode) {
				case FormatMode.AsciiTerminal:
					// since format flags are cumulative, we only need to add the last item if it's an open tag
					if (open) {
						if (activeFormatFlagStack.length > 0) {
							let lastFlagCount: Int = groupedProceedingTags[groupedProceedingTags.length - 1] + 1;
							let asciiFormatString = '';
							for (let i = 0; i < lastFlagCount; i++) {
								let idx = groupedProceedingTags.length - 1 - i;
								asciiFormatString += getAsciiFormat(activeFormatFlagStack[idx]);
							}
							return asciiFormatString;
						} else {
							return '';
						}
					} else {
						return getAsciiFormat(FormatFlag.RESET) +
							activeFormatFlagStack.map(getAsciiFormat)
								.filter(s => s != null)
								.join('');
					}
				case FormatMode.BrowserConsole:
					browserFormatArguments.push(
						activeFormatFlagStack.map(getBrowserFormat)
							.filter(s => s != null)
							.join(';')
					);
					return '%c';
				case FormatMode.Disabled:
					return '';
			}
		});

		return {
			formatted: result,
			browserFormatArguments: browserFormatArguments,
		}
	}

	function determineFormatMode(): FormatMode {
		// if we have a window object, we're in a browser
		if (typeof window !== 'undefined') {
			return FormatMode.BrowserConsole;
		} else {
			let hasProcess = 'process' in globalThis;
			// check for terminal color support
			if (hasProcess && (globalThis as any).process.stdout.isTTY) {
				return FormatMode.AsciiTerminal;
			} else {
				return FormatMode.Disabled;
			}
		}
	}

	type Int = number;

	enum FormatFlag {
		RESET = 'reset',
		BOLD = 'bold',
		ITALIC = 'italic',
		DIM = 'dim',
		UNDERLINE = 'underline',
		BLINK = 'blink',
		INVERT = 'invert',
		HIDDEN = 'hidden',
		BLACK = 'black',
		RED = 'red',
		GREEN = 'green',
		YELLOW = 'yellow',
		BLUE = 'blue',
		MAGENTA = 'magenta',
		CYAN = 'cyan',
		WHITE = 'white',
		LIGHT_BLACK = 'light_black',
		LIGHT_RED = 'light_red',
		LIGHT_GREEN = 'light_green',
		LIGHT_YELLOW = 'light_yellow',
		LIGHT_BLUE = 'light_blue',
		LIGHT_MAGENTA = 'light_magenta',
		LIGHT_CYAN = 'light_cyan',
		LIGHT_WHITE = 'light_white',
		BG_BLACK = 'bg_black',
		BG_RED = 'bg_red',
		BG_GREEN = 'bg_green',
		BG_YELLOW = 'bg_yellow',
		BG_BLUE = 'bg_blue',
		BG_MAGENTA = 'bg_magenta',
		BG_CYAN = 'bg_cyan',
		BG_WHITE = 'bg_white',
		BG_LIGHT_BLACK = 'bg_light_black',
		BG_LIGHT_RED = 'bg_light_red',
		BG_LIGHT_GREEN = 'bg_light_green',
		BG_LIGHT_YELLOW = 'bg_light_yellow',
		BG_LIGHT_BLUE = 'bg_light_blue',
		BG_LIGHT_MAGENTA = 'bg_light_magenta',
		BG_LIGHT_CYAN = 'bg_light_cyan',
		BG_LIGHT_WHITE = 'bg_light_white',
	}

	function formatFlagFromString(str: string): FormatFlag {
		str = str.toLowerCase();

		// normalize hex colors
		if (str.charAt(0) == '#' || str.substring(0, 3) == 'bg#') {
			let hIdx = str.indexOf('#');
			let hex = str.substring(hIdx + 1);

			// expand shorthand hex
			if (hex.length == 3) {
				let a = hex.split('');
				hex = [a[0], a[0], a[1], a[1], a[2], a[2]].join('');
			}

			// validate hex
			if ((/[^0-9a-f]/i).test(hex) || hex.length < 6) {
				// hex contains a non-hexadecimal character or it's too short
				return '' as any; // return empty flag, which has no formatting rules
			}

			let normalized = str.substring(0, hIdx) + '#' + hex;

			return normalized as any;
		}

		// handle aliases
		switch (str) {
			case '/': return FormatFlag.RESET;
			case '!': return FormatFlag.INVERT;
			case 'u': return FormatFlag.UNDERLINE;
			case 'b': return FormatFlag.BOLD;
			case 'i': return FormatFlag.ITALIC;
			case 'gray': return FormatFlag.LIGHT_BLACK;
			case 'bg_gray': return FormatFlag.BG_LIGHT_BLACK;
			default: return str as any;
		}
	}

	enum AsciiColorCodes {
		ASCII_BLACK_CODE = 0,
		ASCII_RED_CODE = 1,
		ASCII_GREEN_CODE = 2,
		ASCII_YELLOW_CODE = 3,
		ASCII_BLUE_CODE = 4,
		ASCII_MAGENTA_CODE = 5,
		ASCII_CYAN_CODE = 6,
		ASCII_WHITE_CODE = 7,
		ASCII_LIGHT_BLACK_CODE = 8,
		ASCII_LIGHT_RED_CODE = 9,
		ASCII_LIGHT_GREEN_CODE = 10,
		ASCII_LIGHT_YELLOW_CODE = 11,
		ASCII_LIGHT_BLUE_CODE = 12,
		ASCII_LIGHT_MAGENTA_CODE = 13,
		ASCII_LIGHT_CYAN_CODE = 14,
		ASCII_LIGHT_WHITE_CODE = 15,
	}

	function getAsciiFormat(flag: FormatFlag): string {flag
		// custom hex color
		if (flag.charAt(0) === '#') {
			const hex = flag.slice(1);
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			return '\x1b[38;5;' + rgbToAscii256(r, g, b) + 'm';
		}

		// custom hex background
		if (flag.slice(0, 3) === 'bg#') {
			const hex = flag.slice(3);
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			return '\x1b[48;5;' + rgbToAscii256(r, g, b) + 'm';
		}

		// octal escape \033 is not allowed in strict mode
		// instead use \x1b
		switch (flag) {
			case FormatFlag.RESET: return '\x1b[m';

			case FormatFlag.BOLD: return '\x1b[1m';
			case FormatFlag.DIM: return '\x1b[2m';
			case FormatFlag.ITALIC: return '\x1b[3m';
			case FormatFlag.UNDERLINE: return '\x1b[4m';
			case FormatFlag.BLINK: return '\x1b[5m';
			case FormatFlag.INVERT: return '\x1b[7m';
			case FormatFlag.HIDDEN: return '\x1b[8m';

			case FormatFlag.BLACK: return '\x1b[38;5;' + AsciiColorCodes.ASCII_BLACK_CODE + 'm';
			case FormatFlag.RED: return '\x1b[38;5;' + AsciiColorCodes.ASCII_RED_CODE + 'm';
			case FormatFlag.GREEN: return '\x1b[38;5;' + AsciiColorCodes.ASCII_GREEN_CODE + 'm';
			case FormatFlag.YELLOW: return '\x1b[38;5;' + AsciiColorCodes.ASCII_YELLOW_CODE + 'm';
			case FormatFlag.BLUE: return '\x1b[38;5;' + AsciiColorCodes.ASCII_BLUE_CODE + 'm';
			case FormatFlag.MAGENTA: return '\x1b[38;5;' + AsciiColorCodes.ASCII_MAGENTA_CODE + 'm';
			case FormatFlag.CYAN: return '\x1b[38;5;' + AsciiColorCodes.ASCII_CYAN_CODE + 'm';
			case FormatFlag.WHITE: return '\x1b[38;5;' + AsciiColorCodes.ASCII_WHITE_CODE + 'm';
			case FormatFlag.LIGHT_BLACK: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_BLACK_CODE + 'm';
			case FormatFlag.LIGHT_RED: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_RED_CODE + 'm';
			case FormatFlag.LIGHT_GREEN: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_GREEN_CODE + 'm';
			case FormatFlag.LIGHT_YELLOW: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_YELLOW_CODE + 'm';
			case FormatFlag.LIGHT_BLUE: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_BLUE_CODE + 'm';
			case FormatFlag.LIGHT_MAGENTA: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_MAGENTA_CODE + 'm';
			case FormatFlag.LIGHT_CYAN: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_CYAN_CODE + 'm';
			case FormatFlag.LIGHT_WHITE: return '\x1b[38;5;' + AsciiColorCodes.ASCII_LIGHT_WHITE_CODE + 'm';

			case FormatFlag.BG_BLACK: return '\x1b[48;5;' + AsciiColorCodes.ASCII_BLACK_CODE + 'm';
			case FormatFlag.BG_RED: return '\x1b[48;5;' + AsciiColorCodes.ASCII_RED_CODE + 'm';
			case FormatFlag.BG_GREEN: return '\x1b[48;5;' + AsciiColorCodes.ASCII_GREEN_CODE + 'm';
			case FormatFlag.BG_YELLOW: return '\x1b[48;5;' + AsciiColorCodes.ASCII_YELLOW_CODE + 'm';
			case FormatFlag.BG_BLUE: return '\x1b[48;5;' + AsciiColorCodes.ASCII_BLUE_CODE + 'm';
			case FormatFlag.BG_MAGENTA: return '\x1b[48;5;' + AsciiColorCodes.ASCII_MAGENTA_CODE + 'm';
			case FormatFlag.BG_CYAN: return '\x1b[48;5;' + AsciiColorCodes.ASCII_CYAN_CODE + 'm';
			case FormatFlag.BG_WHITE: return '\x1b[48;5;' + AsciiColorCodes.ASCII_WHITE_CODE + 'm';
			case FormatFlag.BG_LIGHT_BLACK: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_BLACK_CODE + 'm';
			case FormatFlag.BG_LIGHT_RED: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_RED_CODE + 'm';
			case FormatFlag.BG_LIGHT_GREEN: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_GREEN_CODE + 'm';
			case FormatFlag.BG_LIGHT_YELLOW: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_YELLOW_CODE + 'm';
			case FormatFlag.BG_LIGHT_BLUE: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_BLUE_CODE + 'm';
			case FormatFlag.BG_LIGHT_MAGENTA: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_MAGENTA_CODE + 'm';
			case FormatFlag.BG_LIGHT_CYAN: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_CYAN_CODE + 'm';
			case FormatFlag.BG_LIGHT_WHITE: return '\x1b[48;5;' + AsciiColorCodes.ASCII_LIGHT_WHITE_CODE + 'm';
			// return empty string when ascii format flag is not known
			default: return '';
		}
	}

	function rgbToAscii256(r: number, g: number, b: number): number | null {
		// Find the nearest value's index in the set
		// A metric like ciede2000 would be better, but this will do for now
		function nearIdx(c: number, set: number[]): number {
			let delta = Number.POSITIVE_INFINITY;
			let index = -1;
			for (let i = 0; i < set.length; i++) {
				const d = Math.abs(c - set[i]);
				if (d < delta) {
					delta = d;
					index = i;
				}
			}
			return index;
		}

		function clamp(x: number, min: number, max: number): number {
			return Math.max(Math.min(x, max), min);
		}

		// Colors are index 16 to 231 inclusive = 216 colors
		// Steps are in spaces of 40 except for the first which is 95
		// (0x5f + 40 * (n - 1)) * (n > 0 ? 1 : 0)
		const colorSteps = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
		const ir = nearIdx(r, colorSteps), ig = nearIdx(g, colorSteps), ib = nearIdx(b, colorSteps);
		const ier = Math.abs(r - colorSteps[ir]), ieg = Math.abs(g - colorSteps[ig]), ieb = Math.abs(b - colorSteps[ib]);
		const averageColorError = ier + ieg + ieb;

		// Gray scale values are 232 to 255 inclusive = 24 colors
		// Steps are in spaces of 10
		// 0x08 + 10 * n = c
		const jr = Math.round((r - 0x08) / 10), jg = Math.round((g - 0x08) / 10), jb = Math.round((b - 0x08) / 10);
		const jer = Math.abs(r - clamp((jr * 10 + 0x08), 0x08, 0xee));
		const jeg = Math.abs(g - clamp((jg * 10 + 0x08), 0x08, 0xee));
		const jeb = Math.abs(b - clamp((jb * 10 + 0x08), 0x08, 0xee));
		const averageGrayError = jer + jeg + jeb;

		// If we hit an exact grayscale match then use that instead
		if (averageGrayError < averageColorError && r === g && g === b) {
			const grayIndex = jr + 232;
			return grayIndex;
		} else {
			const colorIndex = 16 + ir * 36 + ig * 6 + ib;
			return colorIndex;
		}
	}

	function getBrowserFormat(flag: FormatFlag): string | null {
		// custom hex color
		if (flag.charAt(0) == '#') {
			return `color: ${flag}`;
		}

		// custom hex background
		if (flag.substring(0, 3) == 'bg#') {
			return `background-color: ${flag.substring(2)}`;
		}

		// inline CSS - browser consoles only
		if (flag.charAt(0) == '{') {
			// return content as-is but remove enclosing braces
			// return flag.substr(1, flag.length - 2);
			return flag.substring(1, flag.length - 1);
		}

		switch (flag) {
			case FormatFlag.RESET: return '';

			case FormatFlag.BOLD: return 'font-weight: bold';
			case FormatFlag.ITALIC: return 'font-style: italic';
			case FormatFlag.DIM: return 'color: gray';
			case FormatFlag.UNDERLINE: return 'text-decoration: underline';
			case FormatFlag.BLINK: return 'text-decoration: blink'; // not supported
			case FormatFlag.INVERT: return '-webkit-filter: invert(100%); filter: invert(100%)'; // not supported
			case FormatFlag.HIDDEN: return 'visibility: hidden; color: white'; // not supported

			case FormatFlag.BLACK: return 'color: black';
			case FormatFlag.RED: return 'color: red';
			case FormatFlag.GREEN: return 'color: green';
			case FormatFlag.YELLOW: return 'color: #f5ba00';
			case FormatFlag.BLUE: return 'color: blue';
			case FormatFlag.MAGENTA: return 'color: magenta';
			case FormatFlag.CYAN: return 'color: cyan';
			case FormatFlag.WHITE: return 'color: whiteSmoke';

			case FormatFlag.LIGHT_BLACK: return 'color: gray';
			case FormatFlag.LIGHT_RED: return 'color: salmon';
			case FormatFlag.LIGHT_GREEN: return 'color: lightGreen';
			case FormatFlag.LIGHT_YELLOW: return 'color: #ffed88';
			case FormatFlag.LIGHT_BLUE: return 'color: lightBlue';
			case FormatFlag.LIGHT_MAGENTA: return 'color: lightPink';
			case FormatFlag.LIGHT_CYAN: return 'color: lightCyan';
			case FormatFlag.LIGHT_WHITE: return 'color: white';

			case FormatFlag.BG_BLACK: return 'background-color: black';
			case FormatFlag.BG_RED: return 'background-color: red';
			case FormatFlag.BG_GREEN: return 'background-color: green';
			case FormatFlag.BG_YELLOW: return 'background-color: gold';
			case FormatFlag.BG_BLUE: return 'background-color: blue';
			case FormatFlag.BG_MAGENTA: return 'background-color: magenta';
			case FormatFlag.BG_CYAN: return 'background-color: cyan';
			case FormatFlag.BG_WHITE: return 'background-color: whiteSmoke';
			case FormatFlag.BG_LIGHT_BLACK: return 'background-color: gray';
			case FormatFlag.BG_LIGHT_RED: return 'background-color: salmon';
			case FormatFlag.BG_LIGHT_GREEN: return 'background-color: lightGreen';
			case FormatFlag.BG_LIGHT_YELLOW: return 'background-color: lightYellow';
			case FormatFlag.BG_LIGHT_BLUE: return 'background-color: lightBlue';
			case FormatFlag.BG_LIGHT_MAGENTA: return 'background-color: lightPink';
			case FormatFlag.BG_LIGHT_CYAN: return 'background-color: lightCyan';
			case FormatFlag.BG_LIGHT_WHITE: return 'background-color: white';
			// return empty string for unknown format
			default: return '';
		}
	}

	function regexMap(pattern: RegExp, str: string, mapFn: (substring: string, ...args: Array<any>) => string): string {
		return str.replace(pattern, mapFn);
	}

}