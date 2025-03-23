import { Express, NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { NamedConsole } from '../NamedConsole';

/**
 * **Explicitly typed routes**
 * @author haxiomic (George Corney)
 * @license MIT
 * 
 * Define route schema with typescript alone, get strictly typed handlers and input validation (using zod)
 * 
 * Usage
 * 
 * ```ts
 * type APIRoutes = {
 * 	'GET /user/:id': {
 * 		query: { api_key: string },
 * 		responseBody: User
 * 	}
 * }>
 * 
 * explicitRoutes<APIRoutes>(
 * 	app,
 * 	{ async 'GET /user/:id'(req, res, next) { ... } },
 * 	{ validators }
 * )
 * ```
 * 
 * Complete example
 * 
 * ```ts
 * type ExampleRouteMap = {
 * 	'GET /hello-world': {
 * 		query: { example: string }
 * 	},
 * 	'POST /update': {
 * 		requestBody: { message: string }
 * 	},
 * 	'GET /user/:id': {
 * 		responseBody: {
 * 			name: string
 * 		}
 * 	},
 * }
 * 
 * handleRoutes<ExampleRouteMap>(app, {
 * 	async "GET /hello-world" (req, res, next) {
 * 		let example = req.query.example;
 * 	},
 * 
 * 	"POST /update": (req, res, next) => {
 * 		let message = req.body.message;
 * 	},
 * 
 * 	async "GET /user/:id" (req, res, next) {
 * 		let id = req.params.id;
 * 
 * 		res.send({ name: 'example' })
 * 	},
 * 	}, {
 * 		'GET /hello-world': {
 * 			query: z.object({
 * 				example: z.string()
 * 			}),
 * 			requestBody: z.any(),
 * 		},
 * 		'POST /update': {
 * 			query: z.any(),
 * 			requestBody: z.object({
 * 				message: z.string()
 * 			})
 * 		},
 * 		'GET /user/:id': {
 * 			query: z.any(),
 * 			requestBody: z.any(),
 * 		}
 * 	}
 * );
 * ```
 */
export function explicitRoutes<R extends InternalRouteMap>(
	app: Express,
	handlers: RouteHandlers<R>,
	validators?: RouteValidators<R>,
	middleware?: (req: Request, res: Response, next: NextFunction) => void
) {
	const console = new NamedConsole('<magenta,b>Explicit Express</>');

	for (const path in handlers) {
		const [method, route] = path.split(' ', 2) as [Method, string];
		if (!methods.includes(method)) {
			throw new Error(`Route must have format \`\$METHOD /path/:param/etc\` where METHOD is one of ${methods.join(', ')}`);
		}

		const routeHandler = handlers[path];

		const validator = validators?.[path];

		const wrappedHandler: typeof routeHandler = async (req, res, next) => {
			try {
				console.log(`${method} ${route}`);
				if (validator?.query) {
					req.query = validator.query.parse(req.query);
				}
				if (validator?.requestBody) {
					req.body = validator.requestBody.parse(req.body);
				}
				
				await routeHandler(req, res, next);
			} catch (err) {
				if (err instanceof ZodError) {
					// log validation errors
					console.error(err.errors);
					res.status(400);
				}

				// catch async errors (which is needed for express < 5)
				next(err);
			}
		}

		if (middleware) {
			app.use(route, middleware);
		}
	
		(app as any)[method.toLowerCase()](route, wrappedHandler);
	}

	return { ...handlers, log: console };
}

export type ExtractParams<S extends string> = S extends `${infer Head}/${infer Tail}`
	? Head extends `:${infer Param}`
		? { [K in Param]: string } & ExtractParams<Tail>
		: ExtractParams<Tail>
	: S extends `:${infer Param}`
	? { [K in Param]: string }
	: {};

/**
 * Given a path with Express params such as `/example/:param1/:param2`
 * This type will extract params to a map `{ param1: string, param2: string }`
 */
export type PathParams<T extends string> = ExtractParams<T extends `/${infer Rest}` ? Rest : T>;

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT'];
export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'CONNECT';

export type RouteKey = `${Method} ${string}`;

export type RouteData<
	PathParams extends { [key: string]: string } = {},
	QueryParams extends { [key: string]: string } = {},
	RequestBody = any,
	ResponseBody = any,
> = {
	pathParams?: PathParams,
	query?: QueryParams,
	requestBody?: RequestBody,
	responseBody?: ResponseBody,
}

/**
 * RouteMap maps from paths `/example` to the route data types
 */
type InternalRouteMap = { [path in RouteKey]: RouteData }

// Utility type to enforce the structure of RouteMap
export type RouteMap<R extends InternalRouteMap> = R;

export type RouteHandlers<R extends InternalRouteMap> = {
	[Path in keyof R]: (
		req: Request<
			PathParams<Path extends `${Method} ${infer P}` ? P : never>,
			R[Path] extends { responseBody: infer RB } ? RB : any,
			R[Path] extends { requestBody: infer RB } ? RB : any,
			R[Path] extends { query: infer QP } ? QP : any
		>,
		res: Response<R[Path] extends { responseBody: infer RB } ? RB : any>,
		next: NextFunction
	) => void
}

export type RouteValidators<R extends InternalRouteMap> = {
	[Path in keyof R]: {
		query: ZodSchema<R[Path] extends { query: infer QP } ? QP : any>,
		requestBody: ZodSchema<R[Path] extends { requestBody: infer RB } ? RB : any>
	}
}