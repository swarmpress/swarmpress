# Custom JavaScript Tools --- Specification

## 1. Overview

Custom JavaScript Tools enable end-users to define small, reusable units
of logic written in JavaScript. Tools are executed in a secure sandbox
(vm2) and described using an explicit schema so that agents understand
what inputs the tool expects, what outputs it returns, and how to safely
call it.

## 2. Tool Structure (Just an idea)

Each tool lives inside its own folder:

    /tools/<tool-id>/
      manifest.json
      tool.js
      README.md (optional)
      examples/ (optional)

### 2.1 manifest.json

Defines the tool contract:

``` json
{
  "name": "fetch-products",
  "description": "Fetch product data from a remote API",
  "input": {
    "category": { "type": "string", "required": true },
    "limit":     { "type": "number", "required": false }
  },
  "output": {
    "products": { "type": "array" },
    "count":    { "type": "number" }
  }
}
```

### 2.2 tool.js

Contains the JavaScript logic executed inside the sandbox:

``` js
const { category, limit } = input;

const data = await api.rest({
  url: `https://api.example.com/products?category=${category}&limit=${limit || 10}`
});

return {
  products: data.items,
  count: data.total
};
```

## 3. Execution Runtime (Server-Side)

Tools execute in a vm2 sandbox to ensure security and isolation.

### 3.1 Sandbox configuration

-   timeout
-   allowAsync: true
-   eval: false
-   wasm: false

### 3.2 Exposed API surface

Only safe, whitelisted APIs:

``` js
api = {
  rest({ url, method, headers, body }) { ... },
  graphql({ url, query, variables }) { ... },
  log(...args) { ... },
  date() { ... }
}
```

## 4. Tool Lifecycle

### 4.1 Creating a tool (UI)

The UI exposes a Tool Builder with metadata editor, input builder,
output builder, Monaco script editor, and preview + save step.

## 5. Tool Invocation (Agents)

Agents read the manifest to understand input schema and output schema,
then call:

    tool: "fetch-products"
    args:
      category: "laptop"
      limit: 20

## 6. Validation

Input validation before execution, output validation after execution.

## 7. Security Model

-   Strict vm2 sandbox
-   No Node internals
-   Whitelisted API only
-   Timeout and memory limits
-   GitHub versioning for auditability

## 8. GitHub Integration

Tools are stored as code in a project repository and versioned via PRs.

## 9. Future Extensions

-   TS type generation
-   Tool templates
-   AI-assisted creation
-   Shared marketplace
