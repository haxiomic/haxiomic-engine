import { EventEmitter } from "../EventEmitter.js";

export type WebSocketRobustOptions = {
	/**
	 * Interval (milliseconds) to wait before attempting to reconnect after an error
	 */
	errorReconnectInterval_ms: number,

	/**
	 * Timeout (milliseconds) used when waiting on the websocket to open before considering it failed (see awaitOpen()). Also used when waiting for the websocket to close before creating a new one.
	 */
	timeout_ms: number,

	/**
	 * WebSocket protocol
	 * see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
	 */
	protocols?: string | string[],
}

/**
 * # Robust WebSocket
 * 
 * - Automatic reconnection after connection is lost
 * - Message queueing; call send() at any time
 * - Aborts connection on abortController.abort(), when connection is aborted, it will not attempt to reconnect
 */
export class WebSocketRobust {

	readonly url: string;
	options: WebSocketRobustOptions = {
		errorReconnectInterval_ms: 500,
		timeout_ms: 5000,
	}
	get aborted() { return this._aborted; }
	get readyState(): ReadyState { return this.connection.readyState; }

	protected connection: WebSocket;

	protected messageQueue = new Array<WSMessage>();
	protected _aborted = false;
	protected explicitCloseRequested = false;
	private lastReadyState: ReadyState | null = null;

	events = {
		message: new EventEmitter<MessageEvent>(),
		open: new EventEmitter<void>(),
		close: new EventEmitter<CloseEvent>(),
		error: new EventEmitter<void>(),
		readyStateChange: new EventEmitter<ReadyState>(),
		abort: new EventEmitter<void>(),
	}

	constructor(
		url: string,
		options?: Partial<WebSocketRobustOptions>,
		public abortController: AbortController = new AbortController()
	) {
		this.url = url;
		this.options = { ...this.options, ...options };
		this.connection = this.createConnection();

		// abort ws connection on abortController.abort()
		abortController.signal.addEventListener('abort', (ev) => {
			this._aborted = true;
			this.events.abort.dispatch();
			this.close();
		});
	}

	/**
	 * Open a connection if closed or closing
	 * 
	 * Multiple calls to open() are safe and will not open multiple connections
	 */
	open() {
		if (this.aborted) return;
		this.explicitCloseRequested = false;

		const readyState: ReadyState = this.connection.readyState;
		switch (readyState) {
			case ReadyState.CONNECTING:
			case ReadyState.OPEN: {
				// do nothing
			} break;
			case ReadyState.CLOSING: {
				// wait for close event
				if (this._waitingOnClosingWebsocket !== this.connection) {
					const closeTimeoutHandle = setTimeout(() => {
						onCloseOrError();
						// @! probably should emit an error event
					}, this.options.timeout_ms);

					const onCloseOrError = () => {
						clearTimeout(closeTimeoutHandle);
						this._waitingOnClosingWebsocket = null;
						this.connection.removeEventListener('close', onCloseOrError);
						this.connection.removeEventListener('error', onCloseOrError);
						this.connection = this.createConnection();
						this.checkReadyState();
					}
					this.connection.addEventListener('close', onCloseOrError);
					this.connection.addEventListener('error', onCloseOrError);
					this._waitingOnClosingWebsocket = this.connection;
				}
			} break;
			case ReadyState.CLOSED: {
				this.connection = this.createConnection();
				this.checkReadyState();
			} break;
		}
	}
	private _waitingOnClosingWebsocket: WebSocket | null = null;

	/**
	 * Try to open a connection if closed and return a promise that resolves when the connection is open
	 */
	awaitOpen(): Promise<void> {
		if (this.aborted) return Promise.resolve();
		this.explicitCloseRequested = false;

		return new Promise((resolve, reject) => {
			this.open();

			switch (this.readyState) {
				case ReadyState.CONNECTING:
				case ReadyState.OPEN: {
					// do nothing
					resolve();
					return;
				} break;
				case ReadyState.CLOSING:
				case ReadyState.CLOSED: {
					// CLOSING or CLOSED state
					// wait for open event before resolving
					const openTimeoutHandle = setTimeout(() => {
						reject(new Error('WebSocketNodeRobust.open() timeout'));
					}, this.options.timeout_ms);

					const onOpen = () => {
						clearTimeout(openTimeoutHandle);
						resolve();
					}

					this.events.open.once(onOpen);
				} break;
			}
		});
	}

	/**
	 * Close the connection, further calls to send() will queue messages try to reconnect
	 */
	close(code?: number, reason?: string) {
		this.explicitCloseRequested = true;
		this.connection.close(code, reason);
	}

	/**
	 * Send a message
	 * 
	 * If the connection is not yet established, the message will be queued and sent when the connection is open
	 */
	send(message: WSMessage) {
		if (this.aborted) return;
		if (this.connection.readyState === WebSocket.OPEN) {
			this.connection.send(message);
		} else {
			console.log('Queuing ws message (connection not yet established)', message);
			this.messageQueue.push(message);
			this.open(); // ask to open connection
		}
	}

	protected reconnectAfterDelay() {
		if (this.aborted) return;

		setTimeout(() => {
			// it's possible the connection was explicitly closed by the user
			// in which case we should not attempt to reconnect
			if (!this.explicitCloseRequested) {
				this.open(); // if this fails, it will call reconnectAfterDelay again
			}
		}, this.options.errorReconnectInterval_ms);
	}

	protected onOpen = (event: Event) => {
		this.checkReadyState();

		this.events.open.dispatch();
		// flush queue
		for (let message of this.messageQueue) {
			this.connection.send(message);
		}
		this.messageQueue.length = 0;
	}

	protected onMessage = (event: MessageEvent) => {
		this.events.message.dispatch(event);
	}

	protected onClose = (event: CloseEvent) => {
		this.checkReadyState();

		this.events.close.dispatch(event);
		if (!event.wasClean) {
			this.reconnectAfterDelay();
		}
	}

	protected onError = (event: Event) => {
		this.checkReadyState();

		this.events.error.dispatch();
		this.reconnectAfterDelay();
	}

	protected checkReadyState() {
		if (this.lastReadyState !== this.connection.readyState) {
			this.lastReadyState = this.connection.readyState;
			this.events.readyStateChange.dispatch(this.connection.readyState);
		}
	}

	protected createConnection() {
		let webSocket = new WebSocket(this.url, this.options.protocols);

		const onClose = (closeEvent: CloseEvent) => {
			this.onClose(closeEvent);
			dispose();
		}
		const onError = (event: Event) => {
			this.onError(event);
			dispose();
		}
		const dispose = () => {
			webSocket.removeEventListener('open', this.onOpen);
			webSocket.removeEventListener('message', this.onMessage);
			webSocket.removeEventListener('close', onClose);
			webSocket.removeEventListener('error', onError);
			webSocket.close();
		}

		webSocket.addEventListener('open', this.onOpen);
		webSocket.addEventListener('message', this.onMessage);
		webSocket.addEventListener('close', onClose);
		webSocket.addEventListener('error', onError);

		return webSocket;
	}

}

type WSMessage = string | ArrayBuffer | Blob | ArrayBufferView;

enum ReadyState {
	CONNECTING = WebSocket.CONNECTING,
	OPEN = WebSocket.OPEN,
	CLOSING = WebSocket.CLOSING,
	CLOSED = WebSocket.CLOSED,
}