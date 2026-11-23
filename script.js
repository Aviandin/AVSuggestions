
"use strict";

// ============================================================
// AVSUGGESTIONS CONFIGURATION
// ============================================================

const CONFIG = {
    API_URL: "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev",
    PLAYER_HEAD_URL: "https://mc-heads.net/avatar/",
    HEAD_SIZE: 38,
    REFRESH_INTERVAL: 60000
};


// ============================================================
// ELEMENTS
// ============================================================

const elements = {
    search: document.getElementById("searchInput"),
    sort: document.getElementById("sortSelect"),
    list: document.getElementById("suggestionList"),
    empty: document.getElementById("emptyState")
};


// ============================================================
// STATE
// ============================================================

const state = {
    suggestions: [],
    loading: false,
    error: null,
    search: "",
    sort: "newest",
    lastUpdated: null
};


// ============================================================
// STATUS CONFIGURATION
// ============================================================

const STATUS_CLASSES = {
    "New": "status-new",
    "Under Review": "status-review",
    "Accepted": "status-accepted",
    "Rejected": "status-rejected",
    "Implemented": "status-implemented"
};


// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    if (!elements.search || !elements.sort || !elements.list) {
        console.error(
            "AVSuggestions: Required HTML elements are missing."
        );
        return;
    }

    elements.search.addEventListener("input", event => {
        state.search = event.target.value.toLowerCase().trim();
        renderSuggestions();
    });

    elements.sort.addEventListener("change", event => {
        state.sort = event.target.value;
        renderSuggestions();
    });

    loadSuggestions();

    // Refresh suggestions periodically.
    setInterval(() => {
        loadSuggestions(true);
    }, CONFIG.REFRESH_INTERVAL);
});


// ============================================================
// LOAD SUGGESTIONS
// ============================================================

async function loadSuggestions(silent = false) {
    if (state.loading) return;

    state.loading = true;

    if (!silent) {
        showLoading();
    }

    try {
        const response = await fetch(
            `${CONFIG.API_URL}/suggestions`,
            {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Server returned HTTP ${response.status}`
            );
        }

        const data = await response.json();

        if (!data.success || !Array.isArray(data.suggestions)) {
            throw new Error("Invalid API response.");
        }

        state.suggestions = data.suggestions;
        state.error = null;
        state.lastUpdated = new Date();

        renderSuggestions();

    } catch (error) {
        console.error(
            "AVSuggestions: Could not load suggestions:",
            error
        );

        state.error = error;

        // Preserve existing results if a background refresh fails.
        if (!silent || state.suggestions.length === 0) {
            showError();
        }

    } finally {
        state.loading = false;
    }
}


// ============================================================
// RENDER SUGGESTIONS
// ============================================================

function renderSuggestions() {
    const search = state.search;

    let suggestions = [...state.suggestions];

    // Search.
    if (search) {
        suggestions = suggestions.filter(suggestion => {
            const searchableText = [
                suggestion.title,
                suggestion.info,
                suggestion.playerName,
                suggestion.status
            ]
                .join(" ")
                .toLowerCase();

            return searchableText.includes(search);
        });
    }

    // Sort.
    suggestions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();

        return state.sort === "oldest"
            ? dateA - dateB
            : dateB - dateA;
    });

    elements.list.replaceChildren();

    if (suggestions.length === 0) {
        showEmpty();
        return;
    }

    elements.empty.style.display = "none";

    const fragment = document.createDocumentFragment();

    for (const suggestion of suggestions) {
        fragment.appendChild(
            createSuggestionCard(suggestion)
        );
    }

    elements.list.appendChild(fragment);
}


// ============================================================
// CREATE SUGGESTION CARD
// ============================================================

function createSuggestionCard(suggestion) {

    const article = document.createElement("article");
    article.className = "suggestion";

    // --------------------------------------------------------
    // TOP SECTION
    // --------------------------------------------------------

    const top = document.createElement("div");
    top.className = "suggestion-top";

    const playerInfo = document.createElement("div");
    playerInfo.className = "player-info";

    // Minecraft head.
    const head = document.createElement("img");

    head.className = "player-head";
    head.alt = `${suggestion.playerName}'s Minecraft head`;
    head.width = CONFIG.HEAD_SIZE;
    head.height = CONFIG.HEAD_SIZE;
    head.loading = "lazy";

    const safePlayerName = encodeURIComponent(
        suggestion.playerName
    );

    head.src =
        `${CONFIG.PLAYER_HEAD_URL}${safePlayerName}/${CONFIG.HEAD_SIZE}`;

    // Fallback if the skin service fails.
    head.addEventListener("error", () => {
        head.style.display = "none";
    }, { once: true });

    // Player details.
    const playerDetails = document.createElement("div");

    const playerName = document.createElement("div");
    playerName.className = "player-name";
    playerName.textContent = suggestion.playerName;

    const date = document.createElement("div");
    date.className = "suggestion-date";
    date.textContent = formatDate(suggestion.date);

    playerDetails.append(playerName, date);

    playerInfo.append(head, playerDetails);

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    const status = document.createElement("span");

    const statusName = STATUS_CLASSES[suggestion.status]
        ? suggestion.status
        : "New";

    status.className =
        `status ${STATUS_CLASSES[statusName]}`;

    status.textContent = statusName;

    top.append(playerInfo, status);

    // --------------------------------------------------------
    // TITLE
    // --------------------------------------------------------

    const title = document.createElement("h2");
    title.textContent = suggestion.title;

    // --------------------------------------------------------
    // DESCRIPTION
    // --------------------------------------------------------

    const description = document.createElement("p");

    description.className = "suggestion-description";
    description.textContent = suggestion.info;

    // --------------------------------------------------------
    // FOOTER
    // --------------------------------------------------------

    const footer = document.createElement("div");
    footer.className = "suggestion-footer";

    const number = document.createElement("span");

    number.textContent =
        `Suggestion #${String(suggestion.id).padStart(3, "0")}`;

    const source = document.createElement("span");
    source.textContent = "Community";

    footer.append(number, source);

    // --------------------------------------------------------
    // ASSEMBLE
    // --------------------------------------------------------

    article.append(
        top,
        title,
        description,
        footer
    );

    // Link to the original GitHub suggestion.
    if (isValidGitHubIssueUrl(suggestion.url)) {
        article.style.cursor = "pointer";
        article.title = "View original suggestion on GitHub";

        article.addEventListener("click", event => {
            if (window.getSelection()?.toString()) return;

            window.open(
                suggestion.url,
                "_blank",
                "noopener,noreferrer"
            );
        });
    }

    return article;
}


// ============================================================
// DATE FORMATTING
// ============================================================

function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unknown date";
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}


// ============================================================
// VALIDATE GITHUB ISSUE URL
// ============================================================

function isValidGitHubIssueUrl(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "https:" &&
            url.hostname === "github.com" &&
            /^\/[^/]+\/AVSuggestions\/issues\/\d+\/?$/.test(
                url.pathname
            )
        );

    } catch {
        return false;
    }
}


// ============================================================
// LOADING STATE
// ============================================================

function showLoading() {
    elements.list.replaceChildren();

    const message = document.createElement("div");

    message.className = "empty-state";
    message.style.display = "block";

    const heading = document.createElement("h2");
    heading.textContent = "Loading suggestions...";

    const description = document.createElement("p");
    description.textContent =
        "Fetching the latest community suggestions.";

    message.append(heading, description);

    elements.list.appendChild(message);

    elements.empty.style.display = "none";
}


// ============================================================
// EMPTY STATE
// ============================================================

function showEmpty() {
    elements.empty.style.display = "block";

    elements.list.replaceChildren();

    const heading = elements.empty.querySelector("h2");
    const description = elements.empty.querySelector("p");

    if (heading) {
        heading.textContent = state.search
            ? "No suggestions found"
            : "No suggestions yet";
    }

    if (description) {
        description.textContent = state.search
            ? "Try searching for something else."
            : "Be the first to share an idea!";
    }
}


// ============================================================
// ERROR STATE
// ============================================================

function showError() {
    elements.list.replaceChildren();

    const message = document.createElement("div");

    message.className = "empty-state";
    message.style.display = "block";

    const heading = document.createElement("h2");
    heading.textContent = "Couldn't load suggestions";

    const description = document.createElement("p");
    description.textContent =
        "The server might be unavailable. Please try again later.";

    const retry = document.createElement("button");

    retry.textContent = "Try again";
    retry.style.marginTop = "16px";
    retry.style.padding = "9px 18px";
    retry.style.border = "none";
    retry.style.borderRadius = "8px";
    retry.style.background = "#9370ff";
    retry.style.color = "white";

    retry.addEventListener("click", () => {
        loadSuggestions();
    });

    message.append(
        heading,
        description,
        retry
    );

    elements.list.appendChild(message);

    elements.empty.style.display = "none";
}


// ============================================================
// PUBLIC API
// ============================================================

window.AVSuggestions = {
    refresh: () => loadSuggestions(),
    getSuggestions: () => [...state.suggestions],
    getLastUpdated: () => state.lastUpdated
};
