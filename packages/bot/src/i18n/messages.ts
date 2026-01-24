/**
 * Bilingual Message Templates (i18n)
 * Format: "English text\n中文文字"
 */

// ==============================================================================
// Start / Help
// ==============================================================================

export const START_WELCOME = `Hello, I'm Dorothy for MoeNet-DN42 (AS4242420998).
你好，我是 MoeNet-DN42 (AS4242420998) 的 桃乐丝。

For more information, please check: 更多信息请查看：
https://dn42.moenet.work/

Use /help to see all available commands.
使用 /help 查看所有可用命令。`;

export const START_COMMANDS = `*Command List 指令列表*

\`\`\`
Tools 工具:
  /ping    - Ping IP/Domain
  /tcping  - TCP Ping
  /trace   - Traceroute
  /route   - Route lookup
  /path    - AS-Path
  /whois   - WHOIS lookup
  /dig     - DNS lookup
  /findnoc - Find NOC

User 用户:
  /login   - Login with ASN
  /logout  - Logout
  /whoami  - Current user

Peer:
  /peer    - Create peer
  /modify  - Modify peer
  /remove  - Remove peer
  /info    - Peer status

Admin:
  /approve - Approve peer
  /nodes   - List nodes
\`\`\``;

// ==============================================================================
// Login
// ==============================================================================

export const LOGIN_ASK_ASN = `Enter your ASN (e.g., 4242421234)
请输入你的 ASN（如 4242421234）`;

export const LOGIN_CHOOSE_METHOD = `Choose authentication method:
选择验证方式：`;

export const LOGIN_SUCCESS = `✅ Welcome! {mnt} AS{asn}
欢迎你！{mnt} AS{asn}`;

export const LOGIN_ALREADY = `ℹ️ You are already logged in as AS{asn}
你已登录为 AS{asn}`;

export const LOGIN_SIGNATURE_CHALLENGE = `🔐 Please sign this challenge with your key:
请使用你的密钥签名以下内容：

\`{challenge}\`

Reply with your signature:
回复签名结果：`;

// ==============================================================================
// Peer Wizard
// ==============================================================================

export const PEER_IDENTITY = `You will create a peer as:
你将以以下身份创建 Peer：

*AS{asn}*

Use /cancel to abort.
使用 /cancel 终止操作。`;

export const PEER_SELECT_NODE = `Which node do you want to peer with?
你想选择哪个节点？`;

export const PEER_INPUT_IPV6 = `Input your DN42 IPv6 address:
请输入你的 DN42 IPv6 地址：

Both Link-Local and ULA are supported.
Link-Local 和 ULA 地址均支持。`;

export const PEER_INPUT_ENDPOINT = `Input your clearnet address for WireGuard:
请输入你的 WireGuard 公网地址：

Enter \`none\` if behind NAT.
如果在 NAT 后面请输入 \`none\``;

export const PEER_INPUT_PORT = `Input your WireGuard port:
请输入你的 WireGuard 端口：`;

export const PEER_INPUT_PUBKEY = `Input your WireGuard public key:
请输入你的 WireGuard 公钥：`;

export const PEER_CONFIRM = `📋 *Please confirm your information:*
请确认你的信息：

*Node 节点:* {node}
*ASN:* AS{asn}
*IPv6:* {ipv6}
*Endpoint:* {endpoint}:{port}
*PublicKey:* \`{pubkey}\`

Enter \`yes\` to confirm.
确认请输入 \`yes\``;

export const PEER_CREATED = `✅ Peer created! Waiting for approval.
Peer 已建立，等待审批！

*My Side 我方信息:*
  Endpoint: {my_endpoint}:{my_port}
  PublicKey: \`{my_pubkey}\`
  DN42 Address: {my_address}`;

export const PEER_INFO = `📍 *Node:* {node}

📤 *Your Side 你的信息:*
  ASN: AS{asn}
  Endpoint: {endpoint}:{port}
  WireGuard Key: \`{pubkey}\`
  DN42 Address: {dn42_addr}

📥 *My Side 我方信息:*
  ASN: AS4242420998
  Endpoint: {my_endpoint}:{my_port}
  WireGuard Key: \`{my_pubkey}\`
  DN42 Address: {my_addr}

📡 *Status:* {status}`;

// ==============================================================================
// Errors
// ==============================================================================

export const ERROR_NOT_LOGGED_IN = `❌ Please login first with /login
请先使用 /login 登录`;

export const ERROR_INVALID_ASN = `❌ Invalid ASN format
无效的 ASN 格式`;

export const ERROR_ASN_NOT_FOUND = `❌ ASN not found in DN42 registry
在 DN42 注册表中未找到该 ASN`;

export const ERROR_NO_PEER = `❌ You don't have any peer yet
你还没有任何 Peer`;

export const CANCELLED = `🚫 Operation cancelled.
操作已取消。`;

// ==============================================================================
// Helper
// ==============================================================================

/**
 * Format template string with values
 */
export function fmt(template: string, values: Record<string, string | number>): string {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return result;
}
