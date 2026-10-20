import {readFile} from 'node:fs/promises';
import {expect, it, vi} from 'vitest';
import {detectProjects} from '../../src/host/reactNative/projectDetection';

vi.mock('node:fs/promises', () => ({readFile: vi.fn()}));

it('detects Expo and React Native across workspace manifests', async () => {
	vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({dependencies: {expo: '*', 'react-native': '*'}})).mockResolvedValueOnce('{}');
	expect(await detectProjects(['/app', '/other'])).toEqual({type: 'project-info', expo: true, reactNative: true});
});

it('detects a bare React Native project declared as a development dependency', async () => {
	vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({devDependencies: {'react-native': '*'}}));
	expect(await detectProjects(['/app'])).toEqual({type: 'project-info', expo: false, reactNative: true});
});

it('keeps generic mode for missing or invalid manifests', async () => {
	vi.mocked(readFile).mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce('{bad json');
	expect(await detectProjects(['/missing', '/invalid'])).toEqual({type: 'project-info', expo: false, reactNative: false});
});
