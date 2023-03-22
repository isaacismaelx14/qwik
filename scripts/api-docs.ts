import { execa } from 'execa';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BuildConfig } from './util';
// import { format } from 'prettier';

export async function generateApiMarkdownDocs(config: BuildConfig, apiJsonInputDir: string) {
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik']);
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik-city']);
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik-city', 'middleware']);
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik-city', 'static']);
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik-city', 'vite']);
  await generateApiMarkdownPackageDocs(config, apiJsonInputDir, ['qwik-react']);
}

async function generateApiMarkdownPackageDocs(
  config: BuildConfig,
  apiJsonInputDir: string,
  pkgNames: string[]
) {
  const pkgDirNames = join(apiJsonInputDir, ...pkgNames);
  if (existsSync(pkgDirNames)) {
    const subPkgDirNames = readdirSync(pkgDirNames);
    for (const subPkgDirName of subPkgDirNames) {
      await generateApiMarkdownSubPackageDocs(config, apiJsonInputDir, [
        ...pkgNames,
        subPkgDirName,
      ]);
    }
  }
}

async function generateApiMarkdownSubPackageDocs(
  config: BuildConfig,
  apiJsonInputDir: string,
  names: string[]
) {
  const subPkgInputDir = join(apiJsonInputDir, ...names);
  const docsApiJsonPath = join(subPkgInputDir, 'docs.api.json');
  if (!existsSync(docsApiJsonPath)) {
    return;
  }

  const subPkgName = ['@builder.io', ...names].filter((n) => n !== 'core').join('/');
  console.log('📚', `Generate API ${subPkgName} markdown docs`);

  const apiOuputDir = join(
    config.rootDir,
    'dist-dev',
    'api-docs',
    names.filter((n) => n !== 'core').join('-')
  );
  mkdirSync(apiOuputDir, { recursive: true });
  console.log(apiOuputDir);

  await execa(
    'api-documenter',
    ['markdown', '--input-folder', subPkgInputDir, '--output-folder', apiOuputDir],
    {
      stdio: 'inherit',
      cwd: join(config.rootDir, 'node_modules', '.bin'),
    }
  );

  // createApiPage(subPkgName, apiOuputDir);
  createApiData(config, docsApiJsonPath, apiOuputDir, subPkgName);
}

// function createApiPage(subPkgName: string, apiOuputDir: string) {
//   const mdDirFiles = readdirSync(apiOuputDir)
//     .filter((m) => m.endsWith('.md'))
//     .map((mdFileName) => {
//       const mdPath = join(apiOuputDir, mdFileName);
//       return {
//         mdFileName,
//         mdPath,
//       };
//     });

//   let apiContent: string[] = [];

//   for (const { mdPath } of mdDirFiles) {
//     const mdOutput = getApiMarkdownOutput(mdPath);
//     apiContent = [...apiContent, ...mdOutput];
//     rmSync(mdPath);
//   }

//   apiContent = [
//     '---',
//     `title: ${subPkgName} API Reference`,
//     '---',
//     '',
//     `# **API** ${subPkgName}`,
//     ...apiContent.slice(12),
//   ];

//   const indexPath = join(apiOuputDir, 'index.md');

//   const mdOutput = format(apiContent.join('\n'), {
//     parser: 'markdown',
//   });

//   writeFileSync(indexPath, mdOutput);
// }

function createApiData(
  config: BuildConfig,
  docsApiJsonPath: string,
  apiOuputDir: string,
  subPkgName: string
) {
  const apiExtractedJson = JSON.parse(readFileSync(docsApiJsonPath, 'utf-8'));

  const apiData: ApiData = {
    id: subPkgName.replace('@builder.io/', '').replace(/\//g, '-'),
    package: subPkgName,
    members: [],
  };

  function addMember(apiExtract: any, hierarchyStr: string) {
    const apiName = apiExtract.name || '';
    if (apiName.length === 0) {
      return;
    }

    const hierarchySplit = hierarchyStr.split('/').filter((m) => m.length > 0);
    hierarchySplit.push(apiName);

    const hierarchy = hierarchySplit.map((h) => {
      return {
        name: h,
        id: getCanonical(hierarchySplit),
      };
    });

    const id = getCanonical(hierarchySplit);

    const mdFile = getMdFile(hierarchySplit);
    const mdPath = join(apiOuputDir, mdFile);

    const content: string[] = [];

    if (existsSync(mdPath)) {
      const mdSrcLines = readFileSync(mdPath, 'utf-8').split(/\r?\n/);

      for (const line of mdSrcLines) {
        if (line.startsWith('## ')) {
          continue;
        }
        if (line.startsWith('[Home]')) {
          continue;
        }
        if (line.startsWith('<!-- ')) {
          continue;
        }
        if (line.startsWith('**Signature:**')) {
          continue;
        }
        content.push(line);
      }
    } else {
      console.log('Unable to find md for', mdFile);
    }

    apiData.members.push({
      name: apiName,
      id,
      hierarchy,
      kind: apiExtract.kind || '',
      content: content.join('\n').trim(),
      mdFile,
    });
  }

  function addMembers(apiExtract: any, hierarchyStr: string) {
    if (Array.isArray(apiExtract?.members)) {
      for (const member of apiExtract.members) {
        addMembers(member, hierarchyStr + '/' + member.name);
        if (member.kind === 'Package' || member.kind === 'EntryPoint') {
          continue;
        }
        if (apiData.members.some((m) => member.name === m.name && member.kind === m.kind)) {
          continue;
        }
        addMember(member, hierarchyStr);
      }
    }
  }

  addMembers(apiExtractedJson, '');

  apiData.members.forEach((m1) => {
    apiData.members.forEach((m2) => {
      while (m1.content.includes(`./${m2.mdFile}`)) {
        m1.content = m1.content.replace(`./${m2.mdFile}`, `#${m2.id}`);
      }
    });
  });

  apiData.members.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  const docsDir = join(config.packagesDir, 'docs', 'src', 'routes', 'api', apiData.id);
  mkdirSync(docsDir, { recursive: true });

  const apiJsonPath = join(docsDir, `api.json`);
  writeFileSync(apiJsonPath, JSON.stringify(apiData, null, 2));

  const apiMdPath = join(docsDir, `index.mdx`);
  writeFileSync(apiMdPath, createApiMarkdown(apiData));
}

function createApiMarkdown(a: ApiData) {
  let md: string[] = [];

  md.push(`---`);
  md.push(`title: \\${a.package} API Reference`);
  md.push(`---`);
  md.push(``);
  md.push(`# **API** ${a.package}`);
  md.push(``);

  for (const m of a.members) {
    md.push(
      `<h2 id="${m.id}"><a aria-hidden="true" tabindex="-1" href="#${m.id}"><span class="icon icon-link"></span></a>${m.name}</h2>`
    );
    md.push(``);

    // sanitize output
    const content = m.content.replace(/<!--(.|\s)*?-->/g, '').replace(/<Slot\/>/g, '');
    md.push(content);
    md.push(``);
  }

  return md.join('\n');
}

interface ApiData {
  id: string;
  package: string;
  members: ApiMember[];
}

interface ApiMember {
  id: string;
  name: string;
  hierarchy: { name: string; id: string }[];
  kind: string;
  content: string;
  mdFile: string;
}

function getCanonical(hierarchy: string[]) {
  return hierarchy.map((h) => getSafeFilenameForName(h)).join('-');
}

function getMdFile(hierarchy: string[]) {
  let mdFile = '';
  for (const h of hierarchy) {
    mdFile += '.' + getSafeFilenameForName(h);
  }
  return `qwik${mdFile}.md`;
}

function getSafeFilenameForName(name: string): string {
  // https://github.com/microsoft/rushstack/blob/d0f8f10a9ce1ce4158ca2da5b79c54c71d028d89/apps/api-documenter/src/utils/Utilities.ts
  return name.replace(/[^a-z0-9_\-\.]/gi, '_').toLowerCase();
}
