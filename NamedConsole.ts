import { Console } from "./Console.js";

export enum LogLevel {
	None = 0,
	Error = 1,
	Warn = 2,
	Log = 3,
	Debug = 4,
}

/**
 * Override console to support formatting and prefixes
 * 
 * @author haxiomic (George Corney)
 * @license MIT
 * 
 * Usage:
 * 
 * const console = new NamedConsole('Example');
 */
export class NamedConsole {

	static colors = [
		'#FF6B6B',
		'#FF9F40',
		'#FFD93D',
		'#6BCF7F',
		'#4ECDC4',
		'#45B7D1',
		'#6C8EBF',
		'#9B7EDE',
		'#D77FB3',
		'#FF6B9D',
	];
	private static currentColorIndex = 0;

	typeFormattingMap = {
		'number': 'green',
		'string': '',
		'boolean': 'magenta',
		'object': '//',
		'undefined': 'black',
		'null': 'blue,b',
		'bigint': 'cyan,b',
		'symbol': 'yellow,b',
		'function': 'magenta,b',
	}

	logLevel: LogLevel = LogLevel.Debug;

	/** emits <$color> before prefix */
	color: string;

	constructor(public prefix: string, logLevel?: LogLevel) {
		if (logLevel != null) this.logLevel = logLevel;
		this.color = NamedConsole.colors[(NamedConsole.currentColorIndex++) % NamedConsole.colors.length];
	}

	log = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		Console.log(`<${this.color}>[${this.prefix}]<//>`, ...args);
	}

	error = (...args: any[]) => {
		if (this.logLevel < LogLevel.Error) return;

		const errorPrefix = Console.errorPrefix;
		const argSeparator = Console.argSeparator;

		let errorStack = new Error();
		let callerInfo = Console.getCallerInfo(errorStack);

		if (callerInfo != null) {
			let callerPrefix = Console.callerInfoPrefix(callerInfo);
			// print debug message
			Console.printlnArgsFormatted([
					errorPrefix + (callerPrefix ? `<b>${callerPrefix}</b>: ` : ''),
					...args
				],
				Console.OutputStream.Error
			);
		} else {
			Console.printlnArgsFormatted([
					errorPrefix,
					...args
				],
				Console.OutputStream.Error
			);
		}
	}

	warn = (...args: any[]) => {
		if (this.logLevel < LogLevel.Warn) return;
		Console.warn(`[${this.prefix}]`, ...args);
	}

	info = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		Console.log(`[${this.prefix}]`, ...args);
	}

	success = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		Console.success(`[${this.prefix}]`, ...args);
	}

	debug = (...args: any[]) => {
		if (this.logLevel < LogLevel.Debug) return;

		const {
			debugPrefix,
			argSeparator,
			emitDebug,
			OutputStream,
		} = Console;
		
		if (!emitDebug) return;

		// get stack trace
		let errorStack = new Error();
		let callerInfo = Console.getCallerInfo(errorStack);

		if (callerInfo != null) {
			let callerPrefix = Console.callerInfoPrefix(callerInfo);
			// print debug message
			Console.printlnArgsFormatted([
					debugPrefix + (callerPrefix ? `<b>${callerPrefix}</b>: ` : ''),
					...args
				],
				OutputStream.Debug
			);
		} else {
			Console.printlnArgsFormatted([
					debugPrefix,
					...args
				],
				OutputStream.Debug
			);
		}
	}

}