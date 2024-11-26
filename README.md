<div align="center">
    <img src=".github/morpho.png" alt="Morpho logo" width="600"/>
    <h1>Morpho Markets 📊</h1>
    <big>Indexes all the markets created on Morpho Blue</big>
    <div>
    <br/>
        <a href="https://github.com/crisog/morpho-markets/pulse"><img src="https://img.shields.io/github/last-commit/crisog/morpho-markets.svg"/></a>
        <a href="https://github.com/crisog/morpho-markets/pulls"><img src="https://img.shields.io/github/issues-pr/crisog/morpho-markets.svg"/></a>
        <a href="https://github.com/crisog/morpho-markets/issues"><img src="https://img.shields.io/github/issues-closed/crisog/morpho-markets.svg"/></a>
    </div>
</div>
<br/>

## Quick start

Morpho Markets indexer is built using [Ponder](https://ponder.sh/).

To start it:

1. Install dependencies:

```bash
yarn install
```

2. Run the codegen:

```bash
yarn codegen
```

3. Run the indexer:

```bash
yarn start
```

## Reading the data

While the indexer is running, it will expose a GraphQL server at http://localhost:42069
