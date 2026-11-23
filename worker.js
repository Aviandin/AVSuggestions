
const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

const MAX_TITLE_LENGTH = 100;
const MAX_INFO_LENGTH = 4000;
const MAX_PLAYER_LENGTH = 16;

const SUGGESTION_MARKER = "<!-- AVSUGGESTION -->";


export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");

        // ------------------------------------------------
        // CORS
        // ------------------------------------------------

        const allowedOrigin = env.ALLOWED_ORIGIN || "*";

        if (
            origin &&
            allowedOrigin !== "*" &&
            origin !== allowedOrigin
        ) {
            return jsonResponse(
                { error: "Origin not allowed." },
                403,
                allowedOrigin
            );
        }

        const corsHeaders = {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders
            });
        }

        try {
            // ------------------------------------------------
            // CONFIGURATION CHECK
            // ------------------------------------------------

            if (
                !env.GITHUB_TOKEN ||
                !env.GITHUB_OWNER ||
                !env.GITHUB_REPO
            ) {
                return jsonResponse(
                    { error: "Server configuration is incomplete." },
                    500,
                    allowedOrigin
                );
            }

            // ------------------------------------------------
            // ROUTES
            // ------------------------------------------------

            if (url.pathname === "/" && request.method === "GET") {
                return jsonResponse({
                    name: "AVSuggestions API",
                    version: "1.0.0",
                    status: "online",
                    endpoints: [
                        "GET /suggestions",
                        "POST /suggestions"
                    ]
                }, 200, allowedOrigin);
            }

            if (url.pathname === "/suggestions") {

                if (request.method === "GET") {
                    return await getSuggestions(
                        env,
                        allowedOrigin
                    );
                }

                if (request.method === "POST") {
                    return await createSuggestion(
                        request,
                        env,
                        allowedOrigin
                    );
                }
            }

            return jsonResponse(
                { error: "Endpoint not found." },
                404,
                allowedOrigin
            );

        } catch (error) {
            console.error("AVSuggestions API error:", error);

            return jsonResponse(
                { error: "An internal server error occurred." },
                500,
                allowedOrigin
            );
        }
    }
};


// ============================================================
// GET SUGGESTIONS
// ============================================================

async function getSuggestions(env, allowedOrigin) {

    const url = new URL(
        `${GITHUB_API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/issues`
    );

    url.searchParams.set("state", "all");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", "created");
    url.searchParams.set("direction", "desc");

    const response = await githubRequest(
        url.toString(),
        env,
        "GET"
    );

    if (!response.ok) {
        console.error("GitHub retrieval failed:", response.status);

        return jsonResponse(
            { error: "Could not retrieve suggestions." },
            502,
            allowedOrigin
        );
    }

    const issues = await response.json();

    const suggestions = issues

        // Exclude pull requests and unrelated issues.
        .filter(issue => {
            return !issue.pull_request &&
                issue.body &&
                issue.body.includes(SUGGESTION_MARKER);
        })

        .map(issue => {

            const body = issue.body || "";

            const parts = body.split(SUGGESTION_MARKER);

            const content = parts[0].split("\n---\n");

            const info = content[0].trim();

            const playerMatch = content[1]?.match(
                /\*\*Submitted by:\*\*\s*(.+)/
            );

            const playerName = playerMatch
                ? playerMatch[1].trim()
                : "Unknown";

            const status = getSuggestionStatus(
                issue.labels || []
            );

            return {
                id: issue.number,
                title: issue.title,
                info: info,
                playerName: playerName,
                date: issue.created_at,
                updatedAt: issue.updated_at,
                status: status,
                url: issue.html_url
            };
        });

    return jsonResponse({
        success: true,
        count: suggestions.length,
        suggestions: suggestions
    }, 200, allowedOrigin);
}


// ============================================================
// CREATE SUGGESTION
// ============================================================

async function createSuggestion(
    request,
    env,
    allowedOrigin
) {

    // --------------------------------------------------------
    // CHECK CONTENT TYPE
    // --------------------------------------------------------

    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
        return jsonResponse(
            { error: "Content-Type must be application/json." },
            415,
            allowedOrigin
        );
    }

    // --------------------------------------------------------
    // READ REQUEST BODY
    // --------------------------------------------------------

    const contentLength = Number(
        request.headers.get("Content-Length") || 0
    );

    if (contentLength > 20000) {
        return jsonResponse(
            { error: "Request is too large." },
            413,
            allowedOrigin
        );
    }

    let data;

    try {
        data = await request.json();
    } catch {
        return jsonResponse(
            { error: "Invalid JSON." },
            400,
            allowedOrigin
        );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return jsonResponse(
            { error: "Invalid request data." },
            400,
            allowedOrigin
        );
    }

    // --------------------------------------------------------
    // VALIDATE FIELDS
    // --------------------------------------------------------

    const title = typeof data.title === "string"
        ? data.title.trim()
        : "";

    const info = typeof data.info === "string"
        ? data.info.trim()
        : "";

    const playerName = typeof data.playerName === "string"
        ? data.playerName.trim()
        : "";

    if (!title || !info || !playerName) {
        return jsonResponse(
            { error: "Title, information, and player name are required." },
            400,
            allowedOrigin
        );
    }

    if (title.length > MAX_TITLE_LENGTH) {
        return jsonResponse(
            { error: "Title is too long." },
            400,
            allowedOrigin
        );
    }

    if (info.length > MAX_INFO_LENGTH) {
        return jsonResponse(
            { error: "Suggestion information is too long." },
            400,
            allowedOrigin
        );
    }

    if (playerName.length > MAX_PLAYER_LENGTH) {
        return jsonResponse(
            { error: "Player name is too long." },
            400,
            allowedOrigin
        );
    }

    // Minecraft Java username validation.
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(playerName)) {
        return jsonResponse(
            { error: "Invalid Minecraft username." },
            400,
            allowedOrigin
        );
    }

    // Prevent someone from injecting our metadata marker.
    if (info.includes(SUGGESTION_MARKER)) {
        return jsonResponse(
            { error: "Invalid suggestion information." },
            400,
            allowedOrigin
        );
    }

    // --------------------------------------------------------
    // GENERATE SUBMISSION DATE
    // --------------------------------------------------------

    const submissionDate = new Date().toISOString();

    // --------------------------------------------------------
    // CREATE GITHUB ISSUE
    // --------------------------------------------------------

    const issueBody = [
        info,
        "",
        "---",
        `**Submitted by:** ${playerName}`,
        `**Submitted:** ${submissionDate}`,
        "",
        SUGGESTION_MARKER
    ].join("\n");

    const githubUrl =
        `${GITHUB_API}/repos/` +
        `${encodeURIComponent(env.GITHUB_OWNER)}/` +
        `${encodeURIComponent(env.GITHUB_REPO)}/issues`;

    const githubResponse = await githubRequest(
        githubUrl,
        env,
        "POST",
        {
            title: title,
            body: issueBody
        }
    );

    if (!githubResponse.ok) {
        const errorDetails = await githubResponse.text();

        console.error(
            "GitHub issue creation failed:",
            githubResponse.status,
            errorDetails
        );

        return jsonResponse(
            { error: "Could not submit suggestion to GitHub." },
            502,
            allowedOrigin
        );
    }

    const issue = await githubResponse.json();

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return jsonResponse({
        success: true,
        message: "Suggestion submitted successfully!",
        suggestion: {
            id: issue.number,
            title: title,
            info: info,
            playerName: playerName,
            date: issue.created_at,
            status: "New",
            url: issue.html_url
        }
    }, 201, allowedOrigin);
}


// ============================================================
// SUGGESTION STATUS
// ============================================================

function getSuggestionStatus(labels) {

    const labelNames = labels.map(label =>
        (typeof label === "string" ? label : label.name || "")
            .toLowerCase()
    );

    if (labelNames.includes("implemented")) {
        return "Implemented";
    }

    if (labelNames.includes("accepted")) {
        return "Accepted";
    }

    if (labelNames.includes("rejected")) {
        return "Rejected";
    }

    if (
        labelNames.includes("under-review") ||
        labelNames.includes("review")
    ) {
        return "Under Review";
    }

    return "New";
}


// ============================================================
// GITHUB REQUEST HELPER
// ============================================================

async function githubRequest(url, env, method, body = null) {

    const headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "AVSuggestions-API"
    };

    if (body !== null) {
        headers["Content-Type"] = "application/json";
    }

    return await fetch(url, {
        method: method,
        headers: headers,
        body: body !== null
            ? JSON.stringify(body)
            : undefined
    });
}


// ============================================================
// JSON RESPONSE HELPER
// ============================================================

function jsonResponse(data, status = 200, allowedOrigin = "*") {

    return new Response(
        JSON.stringify(data, null, 2),
        {
            status: status,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": allowedOrigin,
                "Vary": "Origin"
            }
        }
    );
}
