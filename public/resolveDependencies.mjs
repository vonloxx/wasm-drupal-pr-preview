export const resolveDependencies = (sharedLibs, wrapper) => {
	const _files = [];
	const _libs = [];

	 (sharedLibs || []).forEach(libDef => {
		if(typeof libDef === 'object')
		{
			if(typeof libDef.getLibs === 'function')
			{
				_libs.push(...libDef.getLibs(wrapper.constructor));
			}
			else
			{
				_libs.push(libDef);
			}

			if(typeof libDef.getFiles === 'function')
			{
				_files.push(...libDef.getFiles(wrapper.constructor));
			}
		}
		else
		{
			_libs.push(libDef);
		}
	});

	const files = _files.map(fileDef => {
		const url = String(fileDef.url);
		const path = fileDef.path;
		const name = fileDef.name || path.split('/').pop();
		const parent = path.substr(0, path.length - name.length);
		return {parent, name, url};
	});

	const urlLibs = {};

	const libs = _libs.map(libDef => {
		if(typeof libDef === 'string' || libDef instanceof URL) {
			if(libDef.substr(0, 1) == '/'
				|| libDef.substr(0, 2) == './'
				|| libDef.substr(0, 8) == 'https://'
				|| libDef.substr(0, 7) == 'http://'
			){
				const name = String(libDef).split('/').pop();
				const url  = libDef
				urlLibs[name] = url;

				return {name, url, ini: true};
			}

			return libDef;
		}
		else if(typeof libDef === 'object') {
			const name = libDef.name ?? String(libDef.url).split('/').pop();
			urlLibs[ name ] = libDef.url;

			return libDef;
		}
	});

	return {files, libs, urlLibs};
};
