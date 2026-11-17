export class ImportCancelledError extends Error {
	constructor() { super('操作已取消。'); this.name = 'ImportCancelledError'; }
}

export function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new ImportCancelledError();
}

export async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	checkCancelled(signal);
	await new Promise<void>((resolve, reject) => {
		const finish = (): void => { signal?.removeEventListener('abort', abort); resolve(); };
		const timer = window.setTimeout(finish, milliseconds);
		const abort = (): void => {
			window.clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(new ImportCancelledError());
		};
		signal?.addEventListener('abort', abort, { once: true });
	});
}
