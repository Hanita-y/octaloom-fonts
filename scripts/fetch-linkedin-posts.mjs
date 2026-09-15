// Fetches Hanita's latest original LinkedIn posts via Apify and writes
// data/linkedin-posts.json for the octaloom.com homepage feed.
// Runs in GitHub Actions (Node 20+). Requires APIFY_TOKEN.

import { readFile, writeFile } from "node:fs/promises"

const PROFILE_URL = "https://www.linkedin.com/in/hanita-yudovski/"
const PROFILE_ID = "hanita-yudovski"
const ACTOR = "harvestapi~linkedin-profile-posts"
const OUTPUT = new URL("../data/linkedin-posts.json", import.meta.url)
const POST_COUNT = 3

export function pickPosts(items, profileId = PROFILE_ID, count = POST_COUNT) {
    return items
        .filter((item) => item && item.type === "post" && /^\d+$/.test(String(item.id)))
        .filter((item) => item.author?.publicIdentifier === profileId)
        // Reposts carry the original author; skip anything flagged as a share of another post
        .filter((item) => !item.repostedBy && !item.isRepost && !item.repost)
        .sort((a, b) => (b.postedAt?.timestamp ?? 0) - (a.postedAt?.timestamp ?? 0))
        .slice(0, count)
        .map((item) => ({
            id: String(item.id),
            url: item.linkedinUrl,
            postedAt: item.postedAt?.date ?? null,
            embed: `https://www.linkedin.com/embed/feed/update/urn:li:activity:${item.id}`,
        }))
}

async function runActor(token) {
    const input = {
        targetUrls: [PROFILE_URL],
        maxPosts: 10,
        includeQuotePosts: false,
        includeReposts: false,
        scrapeReactions: false,
        scrapeComments: false,
    }
    const res = await fetch(
        `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=240`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(input),
        }
    )
    if (!res.ok) {
        throw new Error(`Apify run failed: ${res.status} ${await res.text()}`)
    }
    return res.json()
}

async function main() {
    const token = process.env.APIFY_TOKEN
    if (!token) throw new Error("APIFY_TOKEN is not set")

    const items = await runActor(token)
    const posts = pickPosts(Array.isArray(items) ? items : [])

    // Never overwrite a good file with an empty or partial result
    if (posts.length < POST_COUNT) {
        throw new Error(`Expected ${POST_COUNT} posts, got ${posts.length}. Keeping the existing file.`)
    }

    const previous = JSON.parse(await readFile(OUTPUT, "utf8").catch(() => "{}"))
    const sameIds =
        JSON.stringify((previous.posts ?? []).map((p) => p.id)) ===
        JSON.stringify(posts.map((p) => p.id))
    if (sameIds) {
        console.log("No new posts. File unchanged.")
        return
    }

    const data = { updatedAt: new Date().toISOString(), posts }
    await writeFile(OUTPUT, JSON.stringify(data, null, 2) + "\n")
    console.log(`Wrote ${posts.length} posts:`, posts.map((p) => p.id).join(", "))
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => {
        console.error(err.message)
        process.exit(1)
    })
}
