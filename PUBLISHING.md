# Publishing

`upwork-mcp-cli` ships as **two packages** from this one repo:

- **npm:** `upwork-mcp-cli` (the Node CLI) → `npm i -g upwork-mcp-cli` gives users the `upwork` command.
- **PyPI:** `upwork-mcp-cli` (the Python library in [`python/`](python/)) → `pip install upwork-mcp-cli` gives `from upwork_mcp import Upwork`.

Both are automated by [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which runs on a version tag.

## One-time setup

1. **Create tokens**
   - npm: npmjs.com → *Access Tokens* → **Generate → Automation** → copy.
   - PyPI: pypi.org → *Account settings* → **API tokens** → *Add API token* (scope: entire account first time) → copy.
2. **Add them as GitHub secrets** — repo → *Settings → Secrets and variables → Actions → New repository secret*:
   - `NPM_TOKEN` = the npm automation token
   - `PYPI_API_TOKEN` = the PyPI token

## Cut a release

```sh
# 1) bump BOTH versions to the same number
#    - package.json           "version": "0.1.1"
#    - python/pyproject.toml  version = "0.1.1"

# 2) commit, tag, push
git commit -am "Release v0.1.1"
git tag v0.1.1
git push && git push --tags
```

The tag push triggers the workflow → it publishes to npm and PyPI. (You can also run it manually from the **Actions** tab via *Run workflow*.)

> npm and PyPI reject re-publishing an existing version — always bump the version first.

## First publish (manual, optional)

If you'd rather do the very first publish by hand:

```sh
# npm
npm login
npm publish --access public

# PyPI
cd python
python -m pip install --upgrade build twine
python -m build
twine upload dist/*        # username: __token__   password: your PyPI token
```

## What gets published

- **npm** tarball is limited by the `files` field in `package.json` (`bin/`, `src/`, `manifest.json`, `README.md`) — the docs/examples stay on GitHub.
- **PyPI** package is just the `upwork_mcp` module from `python/` (pure stdlib, no dependencies).
