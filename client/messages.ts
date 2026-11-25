import { defineTranslations } from "@getpaseo/plugin/client";

export const messages = defineTranslations({
  resources: {
    en: {
      document: "Document",
      artboard: "Artboard",
      html: "HTML",
      slides: "Slides",
      whiteboard: "Whiteboard",
      verify: "Verification",
      report: "Data report",
      storyboard: "Storyboard",
      notice: {
        comments: "Ryugi · New comments received",
        commentsCount_one: "Ryugi · {{count}} new comment received",
        commentsCount_other: "Ryugi · {{count}} new comments received",
        choices: "Ryugi · Choices submitted",
        choicesWithdrawn: "Ryugi · Choices withdrawn",
        answers: "Ryugi · Answers submitted",
        answersCount_one: "Ryugi · Answer to {{count}} question submitted",
        answersCount_other: "Ryugi · Answers to {{count}} questions submitted",
        answersWithdrawn: "Ryugi · Answers withdrawn",
      },
    },
    "zh-CN": {
      document: "文档",
      artboard: "画板",
      html: "HTML",
      slides: "幻灯片",
      whiteboard: "白板",
      verify: "验证报告",
      report: "数据报告",
      storyboard: "分镜",
      notice: {
        comments: "Ryugi · 收到新评论",
        commentsCount_other: "Ryugi · 收到 {{count}} 条新评论",
        choices: "Ryugi · 已提交方案选择",
        choicesWithdrawn: "Ryugi · 已撤回方案选择",
        answers: "Ryugi · 已提交回答",
        answersCount_other: "Ryugi · 已提交 {{count}} 个问题的回答",
        answersWithdrawn: "Ryugi · 已撤回回答",
      },
    },
  },
});
