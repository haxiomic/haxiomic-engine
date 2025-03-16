import { inspect } from "util";
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
 * const console = new NamedConsole('<magenta,b>Example</>');
 */
export class NamedConsole {

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

	constructor(public prefix: string, logLevel?: LogLevel) {
		if (logLevel != null) this.logLevel = logLevel;
	}

	formatArgs = (args: any[]) => {
		return args.map(arg => {
			const type = typeof arg;
			if (type === 'object') {
				arg = inspect(arg, { colors: true, depth: 5 });
			}
			const format = this.typeFormattingMap[type] ?? 'white';
			return `<${format}>${arg}</>`;
		});
	}

	log = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		args = this.formatArgs(args);
		Console.log(`[${this.prefix}]`, ...args);
	}

	error = (...args: any[]) => {
		if (this.logLevel < LogLevel.Error) return;
		args = this.formatArgs(args);

		const errorPrefix = Console.errorPrefix;
		const argSeparator = Console.argSeparator;

		let errorStack = new Error();
		let callerInfo = Console.getCallerInfo(errorStack);

		if (callerInfo != null) {
			let callerPrefix = Console.callerInfoPrefix(callerInfo);
			// print debug message
			Console.printlnFormatted(errorPrefix + (callerPrefix ? `<b>${callerPrefix}</b>: ` : '') + args.join(argSeparator), Console.OutputStream.Error);
		} else {
			Console.printlnFormatted(errorPrefix + args.join(argSeparator), Console.OutputStream.Error);
		}
	}

	warn = (...args: any[]) => {
		if (this.logLevel < LogLevel.Warn) return;
		args = this.formatArgs(args);
		Console.warn(`[${this.prefix}]`, ...args);
	}

	info = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		args = this.formatArgs(args);
		Console.log(`[${this.prefix}]`, ...args);
	}

	success = (...args: any[]) => {
		if (this.logLevel < LogLevel.Log) return;
		args = this.formatArgs(args);
		Console.success(`[${this.prefix}]`, ...args);
	}

	debug = (...args: any[]) => {
		if (this.logLevel < LogLevel.Debug) return;
		args = this.formatArgs(args);

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
			Console.printlnFormatted(debugPrefix + (callerPrefix ? `<b>${callerPrefix}</b>: ` : '') + args.join(argSeparator), OutputStream.Debug);
		} else {
			Console.printlnFormatted(debugPrefix + args.join(argSeparator), OutputStream.Debug);
		}
	}

}