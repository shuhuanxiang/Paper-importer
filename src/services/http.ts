import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { checkCancelled, delay, ImportCancelledError } from '../utils/tasks';

export class HttpError extends Error {
	constructor(public readonly status: number) {
		super(status === 401 || status === 403
			? `服务返回 HTTP ${status}，请检查访问权限或 API token。`
			: status === 429 ? '服务请求过于频繁，请稍后重试（HTTP 429）。'
				: `服务返回 HTTP ${status}。`);
	}
}

class HttpRequestError extends Error {}

export function validateServiceUrl(value: string): string {
	let url: URL;
	try { url = new URL(value); } catch { throw new Error('服务地址格式无效。'); }
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
		throw new Error('请使用 HTTPS 服务地址；本机服务可使用 HTTP。');
	}
	return url.toString();
}

export async function httpRequest(
	params: RequestUrlParam,
	signal?: AbortSignal,
	timeoutMs = 60_000,
): Promise<RequestUrlResponse> {
	validateServiceUrl(params.url);
	const attempts = (params.method ?? 'GET') === 'GET' ? 3 : 1;
	for (let attempt = 0; attempt < attempts; attempt++) {
		checkCancelled(signal);
		try {
			const response = await requestOnce(params, signal, timeoutMs);
			checkCancelled(signal);
			if (response.status < 200 || response.status >= 300) throw new HttpError(response.status);
			return response;
		} catch (error) {
			if (error instanceof ImportCancelledError) throw error;
			const retryable = error instanceof HttpRequestError
				|| (error instanceof HttpError && (error.status === 429 || error.status >= 500));
			if (!retryable || attempt === attempts - 1) throw error;
			await delay(1500 * (attempt + 1), signal);
		}
	}
	throw new Error('网络请求失败。');
}

async function requestOnce(
	params: RequestUrlParam,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<RequestUrlResponse> {
	checkCancelled(signal);
	let timer: number | undefined;
	let abort: (() => void) | undefined;
	try {
		return await new Promise<RequestUrlResponse>((resolve, reject) => {
			timer = window.setTimeout(() => reject(new HttpRequestError('网络请求超时，请检查连接后重试。')), timeoutMs);
			abort = () => reject(new ImportCancelledError());
			signal?.addEventListener('abort', abort, { once: true });
			try {
				Promise.resolve(requestUrl({ ...params, throw: false })).then(resolve, () => {
					reject(new HttpRequestError('网络请求失败，请检查连接后重试。'));
				});
			} catch {
				reject(new HttpRequestError('网络请求失败，请检查连接后重试。'));
			}
		});
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
		if (abort) signal?.removeEventListener('abort', abort);
	}
}
