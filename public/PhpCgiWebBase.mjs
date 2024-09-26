import { PhpCgiBase } from './PhpCgiBase.mjs';
import { commitTransaction, startTransaction } from './webTransactions.mjs';
import { resolveDependencies } from './resolveDependencies.mjs';

const STR = 'string';
const NUM = 'number';

export class PhpCgiWebBase extends PhpCgiBase
{
	startTransaction()
	{
		return startTransaction(this);
	}

	commitTransaction()
	{
		return commitTransaction(this);
	}

	async _beforeRequest()
	{
		if(!this.initialized)
		{
			await navigator.locks.request('php-wasm-fs-lock', async () => {
				const php = await this.binary;
				await this.loadInit(php);
				await new Promise((accept,reject) => php.FS.syncfs(true, err => {
					if(err) reject(err);
					else    accept();
				}));
			});
		}

		this.initialized = true;
	}

	async _afterRequest()
	{
		await navigator.locks.request('php-wasm-fs-lock', async () => {
			const php = await this.binary;
			await new Promise((accept,reject) => php.FS.syncfs(false, err => {
				if(err) reject(err);
				else    accept();
			}));
		});
	}

	refresh()
	{
		const {files, libs, urlLibs} = resolveDependencies(this.sharedLibs, this);

		const userLocateFile = this.phpArgs.locateFile || (() => undefined);

		const locateFile = path => {
			let located = userLocateFile(path);
			if(located !== undefined)
			{
				return located;
			}
			if(urlLibs[path])
			{
				return urlLibs[path];
			}
		};

		const phpArgs = {
			persist: [{mountPath:'/persist'}, {mountPath:'/config'}]
			, ...this.phpArgs
			, stdin: () =>  this.input
				? String(this.input.shift()).charCodeAt(0)
				: null
			, stdout: x => this.output.push(x)
			, stderr: x => this.error.push(x)
			, locateFile
		};

		this.binary = navigator.locks.request('php-wasm-fs-lock', async () => {

			const php = await new this.PHP(phpArgs);

			await php.ccall(
				'pib_storage_init'
				, NUM
				, []
				, []
				, {async: true}
			);

			if(!php.FS.analyzePath('/preload').exists)
			{
				php.FS.mkdir('/preload');
			}

			await this.files.concat(files).forEach(
				fileDef => php.FS.createPreloadedFile(fileDef.parent, fileDef.name, fileDef.url, true, false)
			);

			const iniLines = libs.map(lib => {
				if(typeof lib === 'string' || lib instanceof URL)
				{
					return `extension=${lib}`;
				}
				else if(typeof lib === 'object' && lib.ini)
				{
					return `extension=${String(lib.url).split('/').pop()}`;
				}
			});

			this.phpArgs.ini && iniLines.push(this.phpArgs.ini.replace(/\n\s+/g, '\n'));

			php.FS.writeFile('/php.ini', iniLines.join("\n") + "\n", {encoding: 'utf8'});

			await new Promise((accept, reject) => {
				php.FS.syncfs(true, error => {
					if(error) reject(error);
					else accept();
				});
			});

			await php.ccall(
				'wasm_sapi_cgi_init'
				, 'number'
				, []
				, []
				, {async: true}
			);

			await this.loadInit(php);

			return php;

		});
	}

	async _enqueue(callback, params = [])
	{
		let accept, reject;

		const coordinator = new Promise((a,r) => [accept, reject] = [a, r]);

		this.queue.push([callback, params, accept, reject]);

		navigator.locks.request('php-wasm-fs-lock', async () => {

			if(!this.queue.length)
			{
				return;
			}

			await (this.autoTransaction ? this.startTransaction() : Promise.resolve());

			do
			{
				const [callback, params, accept, reject] = this.queue.shift();
				await callback(...params).then(accept).catch(reject);
				let lockChecks = 5;
				while(!this.queue.length && lockChecks--)
				{
					await new Promise(a => setTimeout(a, 5));
				}
			} while(this.queue.length)

			await (this.autoTransaction ? this.commitTransaction() : Promise.resolve());
		});

		return coordinator;
	}
}