export type RecommendationTopic = {
  id: string;
  name: string;
  aliases: string[];
};

/**
 * A deliberately small, shared taxonomy.  Topic ids are stable API values and
 * are also the order `themeId` values used by the existing booking flow.
 */
export const RECOMMENDATION_TOPICS: RecommendationTopic[] = [
  { id: "t1", name: "情绪倾听", aliases: ["情绪倾听", "情绪", "倾听", "心理", "疏解"] },
  { id: "t2", name: "职场减压", aliases: ["职场减压", "职场", "沟通", "压力"] },
  { id: "t3", name: "睡前语音", aliases: ["睡前语音", "睡前", "晚间", "声音"] },
  { id: "t4", name: "学习陪伴", aliases: ["学习陪伴", "学习", "专注", "考研", "监督"] },
  { id: "t5", name: "运动鼓励", aliases: ["运动鼓励", "运动", "健身", "跑步"] },
  { id: "t6", name: "兴趣聊天", aliases: ["兴趣聊天", "兴趣", "电影", "旅行", "摄影", "聊天"] }
];

const topicById = new Map(RECOMMENDATION_TOPICS.map((topic) => [topic.id, topic]));

export function isRecommendationTopicId(value: string): boolean {
  return topicById.has(value);
}

export function topicName(topicId: string): string {
  return topicById.get(topicId)?.name ?? topicId;
}

export function normalizeTopicIds(values: readonly string[] | undefined | null): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(isRecommendationTopicId))];
}

export function deriveTopicIds(...valueGroups: Array<readonly string[] | undefined | null>): string[] {
  const normalized = valueGroups
    .flatMap((values) => values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return RECOMMENDATION_TOPICS
    .filter((topic) => topic.aliases.some((alias) => normalized.some((value) => value.includes(alias.toLowerCase()))))
    .map((topic) => topic.id);
}
