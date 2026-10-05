# pi-web-fetch

A `web_fetch` tool for the [Pi coding agent](https://pi.dev). It reads a URL and returns its main content as markdown, sized for a model's context.

```bash
pi install git:github.com/laspinacristian/pi-web-fetch
```

## Behavior

| Input | Output |
|---|---|
| HTML page | Main content extracted with [Defuddle](https://github.com/kepano/defuddle). Code blocks keep their language; images, navigation and link targets are dropped |
| Markdown | Requested first through content negotiation, which many documentation sites support |
| PDF | Text layer, extracted with [unpdf](https://github.com/unjs/unpdf) |
| PNG, JPEG, GIF, WebP | An image block the model can see (up to 5 MB) |
| YouTube video | Transcript, with chapters |
| GitHub issue or pull request | Body, comments, reviews, review comments and changed files, from the REST API |
| GitHub file | The raw file |
| Stack Exchange question | Question, all answers and comments, from the API. The linked answer comes first, then the accepted one |
| Text, JSON, XML, diff | Unchanged |

Output over 30,000 characters is cut at a paragraph boundary. The full text is saved to a temporary file, and its path is returned together with the sections that were left out.

Requests present a Chrome TLS fingerprint ([wreq-js](https://github.com/sqdshguy/wreq-js)); Node's `fetch` is used where its native binary is unavailable. When a site refuses the request, or the page has no content without JavaScript, the page is looked up in Brave's index through the LLM Context API.

## Parameters

| Name | Description |
|---|---|
| `url` | URL to fetch |
| `links` | Keep hyperlinks. Default: `false` |
| `language` | Preferred language as a BCP 47 tag; also selects the YouTube transcript. Default: English |

## Configuration

| Variable | Effect |
|---|---|
| `BRAVE_API_KEY` | Enables the Brave index fallback |
| `GITHUB_TOKEN`, `GH_TOKEN` | Token for the GitHub API. Without one, `gh auth token` is used if the GitHub CLI is logged in. Without any, the limit is 60 requests per hour and private repositories are unreachable |

## Limitations

- Pages rendered client-side and absent from Brave's index, such as Quora, cannot be read. Neither can pages behind a login.
- The Stack Exchange API allows 300 requests per day per IP address without a key.

## Development

```bash
npm install
npm run check   # type check
npm test        # offline tests
```

## License

[MIT](LICENSE)
