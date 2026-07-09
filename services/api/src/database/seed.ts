import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { validateEnvironment } from "../config/configuration";

const environment = validateEnvironment(process.env);
const prisma = new PrismaClient({
  adapter: new PrismaPg(environment.DATABASE_URL)
});

type SeedCompanion = {
  id: string;
  name: string;
  role: string;
  initials: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  pricePerHalfHour: number;
  isOnline: boolean;
  isVerified: boolean;
  bio: string;
  availableTimes: string[];
  languages: string[];
  specialties: string[];
  completedOrders: number;
  responseTime: string;
  distanceKm: number;
  availability: "online" | "available" | "busy";
  cityDistrict: string;
};

export const seedCompanions: SeedCompanion[] = [
  {
    id: "c1",
    name: "林屿",
    role: "温柔倾听者",
    initials: "LY",
    tags: ["心理学背景", "深夜在线"],
    rating: 4.9,
    reviewCount: 168,
    pricePerHalfHour: 39,
    isOnline: true,
    isVerified: true,
    bio: "擅长倾听和梳理情绪，尊重边界，仅平台内沟通。",
    availableTimes: ["20:00", "21:30", "23:00"],
    languages: ["中文", "英语"],
    specialties: ["情绪倾听", "睡前语音"],
    completedOrders: 426,
    responseTime: "约30秒",
    distanceKm: 1.2,
    availability: "online",
    cityDistrict: "南山区"
  },
  {
    id: "c2",
    name: "许澈",
    role: "职场沟通陪伴",
    initials: "XC",
    tags: ["职业沟通", "疏解压力", "高效"],
    rating: 4.8,
    reviewCount: 116,
    pricePerHalfHour: 49,
    isOnline: true,
    isVerified: true,
    bio: "聊职场压力和沟通卡点，帮你理清下一步。",
    availableTimes: ["12:30", "19:00", "22:00"],
    languages: ["中文"],
    specialties: ["职场减压", "学习陪伴"],
    completedOrders: 318,
    responseTime: "约1分钟",
    distanceKm: 2.8,
    availability: "available",
    cityDistrict: "宝安区"
  },
  {
    id: "c3",
    name: "周映",
    role: "睡前声音陪伴",
    initials: "ZY",
    tags: ["情绪稳定", "慢节奏"],
    rating: 4.9,
    reviewCount: 204,
    pricePerHalfHour: 45,
    isOnline: false,
    isVerified: true,
    bio: "晚间轻声陪伴，适合想慢慢聊、整理一天的时候。",
    availableTimes: ["22:30", "23:30", "00:30"],
    languages: ["中文", "粤语"],
    specialties: ["睡前语音", "情绪倾听"],
    completedOrders: 512,
    responseTime: "约5分钟",
    distanceKm: 4.5,
    availability: "busy",
    cityDistrict: "前海"
  },
  {
    id: "c4",
    name: "沈一",
    role: "专注陪跑伙伴",
    initials: "SY",
    tags: ["互相监督", "考研陪伴"],
    rating: 4.7,
    reviewCount: 92,
    pricePerHalfHour: 29,
    isOnline: true,
    isVerified: true,
    bio: "陪你定小目标、打卡复盘，不鸡血不施压。",
    availableTimes: ["08:00", "14:00", "20:00"],
    languages: ["中文"],
    specialties: ["学习陪伴", "运动鼓励"],
    completedOrders: 180,
    responseTime: "约45秒",
    distanceKm: 0.8,
    availability: "online",
    cityDistrict: "南山区"
  },
  {
    id: "c5",
    name: "闻舟",
    role: "兴趣聊天搭子",
    initials: "WZ",
    tags: ["电影", "旅行", "摄影"],
    rating: 4.6,
    reviewCount: 74,
    pricePerHalfHour: 35,
    isOnline: true,
    isVerified: false,
    bio: "聊电影、旅行和摄影，轻松交换想法，仅线上交流。",
    availableTimes: ["10:00", "16:00", "21:00"],
    languages: ["中文", "日语"],
    specialties: ["兴趣聊天", "情绪倾听"],
    completedOrders: 139,
    responseTime: "约2分钟",
    distanceKm: 3.1,
    availability: "available",
    cityDistrict: "西城区"
  }
];

type SeedClient = {
  companionProfile: Pick<PrismaClient["companionProfile"], "upsert">;
  companionServiceTag: Pick<PrismaClient["companionServiceTag"], "deleteMany" | "upsert">;
  serviceTag: Pick<PrismaClient["serviceTag"], "upsert">;
};

export async function seedDatabase(client: SeedClient = prisma) {
  for (const companion of seedCompanions) {
    await client.companionProfile.upsert({
      where: { id: companion.id },
      create: {
        id: companion.id,
        name: companion.name,
        role: companion.role,
        initials: companion.initials,
        rating: companion.rating,
        reviewCount: companion.reviewCount,
        pricePerHalfHour: companion.pricePerHalfHour,
        isOnline: companion.isOnline,
        isVerified: companion.isVerified,
        bio: companion.bio,
        availableTimes: companion.availableTimes,
        languages: companion.languages,
        specialties: companion.specialties,
        completedOrders: companion.completedOrders,
        responseTime: companion.responseTime,
        distanceKm: companion.distanceKm,
        availability: companion.availability,
        cityDistrict: companion.cityDistrict,
        isPublished: true
      },
      update: {
        name: companion.name,
        role: companion.role,
        initials: companion.initials,
        rating: companion.rating,
        reviewCount: companion.reviewCount,
        pricePerHalfHour: companion.pricePerHalfHour,
        isOnline: companion.isOnline,
        isVerified: companion.isVerified,
        bio: companion.bio,
        availableTimes: companion.availableTimes,
        languages: companion.languages,
        specialties: companion.specialties,
        completedOrders: companion.completedOrders,
        responseTime: companion.responseTime,
        distanceKm: companion.distanceKm,
        availability: companion.availability,
        cityDistrict: companion.cityDistrict,
        isPublished: true
      }
    });

    await client.companionServiceTag.deleteMany({
      where: { companionId: companion.id }
    });

    for (const tagName of companion.tags) {
      const tag = await client.serviceTag.upsert({
        where: { name: tagName },
        create: { name: tagName },
        update: {}
      });

      await client.companionServiceTag.upsert({
        where: {
          companionId_tagId: {
            companionId: companion.id,
            tagId: tag.id
          }
        },
        create: {
          companionId: companion.id,
          tagId: tag.id
        },
        update: {}
      });
    }
  }
}

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
