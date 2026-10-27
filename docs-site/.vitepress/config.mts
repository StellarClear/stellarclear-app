import { defineConfig } from "vitepress";
export default defineConfig({
  title: "StellarClear",
  description: "Open-source Stellar-native settlement evidence and reconciliation protocol.",
  base: process.env.VITEPRESS_BASE || (process.env.GITHUB_ACTIONS ? "/stellarclear-app/" : "/"),
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    logo: "/banner.jpeg",
    siteTitle: "StellarClear Docs",
    nav: [
      { text: "⚡ Live Dashboard", link: "/dashboard" },
      { text: "Getting Started", link: "/getting-started/overview" },
      { text: "Protocol", link: "/protocol-concepts/lifecycle" },
      { text: "User Guides", link: "/user-guides/case-owner" },
      { text: "Developers", link: "/developer-guide/environment" },
      { text: "Reference", link: "/reference/api" },
      { text: "Community", link: "/community/contributing" },
      { text: "v0.1.1", link: "https://github.com/StellarClear/stellarclear-app/releases/tag/v0.1.1" },
    ],
    sidebar: {
      "/getting-started/": [
        {
          text: "Getting Started",
          items: [
            { text: "Overview & Problem Statement", link: "/getting-started/overview" },
            { text: "Quick Start Guide", link: "/getting-started/quickstart" },
            { text: "Architecture & Trust Model", link: "/getting-started/architecture" },
          ],
        },
      ],
      "/protocol-concepts/": [
        {
          text: "Protocol Concepts",
          items: [
            { text: "Settlement Lifecycle & State Machine", link: "/protocol-concepts/lifecycle" },
            { text: "Break Taxonomy & Classification", link: "/protocol-concepts/break-taxonomy" },
            { text: "Canonical Serialization & Commitments", link: "/protocol-concepts/commitments" },
            { text: "Settlement Proofs & Attestations", link: "/protocol-concepts/proofs-and-attestations" },
          ],
        },
      ],
      "/user-guides/": [
        {
          text: "Role-Based User Guides",
          items: [
            { text: "Case Owner Guide", link: "/user-guides/case-owner" },
            { text: "Counterparty Guide", link: "/user-guides/counterparty" },
            { text: "Independent Observer Guide", link: "/user-guides/independent-observer" },
            { text: "Dispute Resolution & Arbitration", link: "/user-guides/dispute-arbitrator" },
          ],
        },
      ],
      "/developer-guide/": [
        {
          text: "Developer & Operator Guide",
          items: [
            { text: "Environment & Configuration", link: "/developer-guide/environment" },
            { text: "TypeScript SDK Integration", link: "/developer-guide/sdk" },
            { text: "Docker & Deployment Topology", link: "/developer-guide/deployment" },
            { text: "Operations & Incident Response", link: "/developer-guide/operations" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "REST API Reference", link: "/reference/api" },
            { text: "Smart Contract Reference", link: "/reference/contract" },
            { text: "Error Codes Reference", link: "/reference/error-codes" },
            { text: "Protocol Glossary", link: "/reference/glossary" },
          ],
        },
      ],
      "/community/": [
        {
          text: "Community & Governance",
          items: [
            { text: "Contributing Guide", link: "/community/contributing" },
            { text: "Security Policy", link: "/community/security" },
            { text: "Roadmap & Scope", link: "/community/roadmap" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/StellarClear/stellarclear-app" },
      { icon: "discord", link: "https://discord.gg/stellardev" },
    ],
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright © 2026 StellarClear Contributors",
    },
  },
});
