# agent-browser CLI Reference

## Core Commands

| Command | Description |
|---------|-------------|
| `open <url>` | Navigate to URL |
| `click <sel>` | Click element (or @ref) |
| `dblclick <sel>` | Double-click element |
| `type <sel> <text>` | Type into element (appends) |
| `fill <sel> <text>` | Clear and fill |
| `press <key>` | Press key (Enter, Tab, Control+a) |
| `hover <sel>` | Hover element |
| `focus <sel>` | Focus element |
| `check <sel>` | Check checkbox |
| `uncheck <sel>` | Uncheck checkbox |
| `select <sel> <val...>` | Select dropdown option |
| `drag <src> <dst>` | Drag and drop |
| `upload <sel> <files...>` | Upload files |
| `download <sel> <path>` | Download file by clicking element |
| `scroll <dir> [px]` | Scroll (up/down/left/right) |
| `scrollintoview <sel>` | Scroll element into view |
| `wait <sel\|ms>` | Wait for element or time |
| `screenshot [path]` | Take screenshot |
| `pdf <path>` | Save as PDF |
| `snapshot` | Accessibility tree with refs (for AI) |
| `eval <js>` | Run JavaScript |
| `connect <port\|url>` | Connect to browser via CDP |
| `close` | Close browser |

## Navigation

| Command | Description |
|---------|-------------|
| `back` | Go back |
| `forward` | Go forward |
| `reload` | Reload page |

## Get Info: `get <what> [selector]`

| Subcommand | Description |
|------------|-------------|
| `text` | Get text content |
| `html` | Get innerHTML |
| `value` | Get input value |
| `attr <name>` | Get attribute value |
| `title` | Get page title |
| `url` | Get current URL |
| `count` | Count matching elements |
| `box` | Get bounding box |
| `styles` | Get computed styles |

## Check State: `is <what> <selector>`

| Subcommand | Description |
|------------|-------------|
| `visible` | Check visibility |
| `enabled` | Check if enabled |
| `checked` | Check if checked |

## Find Elements: `find <locator> <value> <action> [text]`

Locator types: `role`, `text`, `label`, `placeholder`, `alt`, `title`, `testid`, `first`, `last`, `nth`

## Mouse: `mouse <action> [args]`

| Subcommand | Description |
|------------|-------------|
| `move <x> <y>` | Move mouse |
| `down [btn]` | Press mouse button |
| `up [btn]` | Release mouse button |
| `wheel <dy> [dx]` | Scroll wheel |

## Browser Settings: `set <setting> [value]`

| Subcommand | Description |
|------------|-------------|
| `viewport <w> <h>` | Set viewport size |
| `device <name>` | Emulate device |
| `geo <lat> <lng>` | Set geolocation |
| `offline [on\|off]` | Toggle offline mode |
| `headers <json>` | Set HTTP headers |
| `credentials <user> <pass>` | Set HTTP auth |
| `media [dark\|light] [reduced-motion]` | Set media features |

## Network: `network <action>`

| Subcommand | Description |
|------------|-------------|
| `route <url> [--abort\|--body <json>]` | Intercept requests |
| `unroute [url]` | Remove route |
| `requests [--clear] [--filter <pattern>]` | View network requests |

## Storage

| Command | Description |
|---------|-------------|
| `cookies [get\|set\|clear]` | Manage cookies |
| `storage <local\|session>` | Manage web storage |

## Tabs

| Command | Description |
|---------|-------------|
| `tab [new\|list\|close\|<n>]` | Manage tabs |

## Debug

| Command | Description |
|---------|-------------|
| `trace start\|stop [path]` | Record trace |
| `record start <path> [url]` | Start video recording (WebM) |
| `record stop` | Stop and save video |
| `console [--clear]` | View console logs |
| `errors [--clear]` | View page errors |
| `highlight <sel>` | Highlight element |

## Snapshot Options

| Flag | Description |
|------|-------------|
| `-i`, `--interactive` | Only interactive elements |
| `-c`, `--compact` | Remove empty structural elements |
| `-d <n>`, `--depth <n>` | Limit tree depth |
| `-s <sel>`, `--selector <sel>` | Scope to CSS selector |

## Global Options

| Flag | Description |
|------|-------------|
| `--session <name>` | Isolated session name |
| `--profile <path>` | Persistent browser profile |
| `--json` | JSON output |
| `--full`, `-f` | Full page screenshot |
| `--headed` | Show browser window |
| `--cdp <port>` | Connect via Chrome DevTools Protocol |
| `--debug` | Debug output |
| `--ignore-https-errors` | Ignore HTTPS certificate errors |
