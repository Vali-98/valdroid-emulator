import {readFile} from 'node:fs/promises';
import * as path from 'node:path';
import type {ProjectInfo} from '../../shared/protocol';

export async function detectProjects(roots: string[]): Promise<ProjectInfo> {
	const projects = await Promise.all(roots.map(async root => {
		try {
			const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
			const dependencies = {...manifest.dependencies, ...manifest.devDependencies};
			return {expo: Boolean(dependencies.expo), reactNative: Boolean(dependencies['react-native'])};
		} catch {return {expo: false, reactNative: false};}
	}));
	return {type: 'project-info', expo: projects.some(project => project.expo), reactNative: projects.some(project => project.reactNative)};
}
