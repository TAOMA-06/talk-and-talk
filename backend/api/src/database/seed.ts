import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { validateEnvironment } from "../config/configuration";
import { deriveTopicIds } from "../recommendations/recommendation-topics";

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

function seedAvailabilityWindows(index: number) {
  const firstStart = new Date();
  firstStart.setUTCDate(firstStart.getUTCDate() + 1);
  firstStart.setUTCHours(12 + (index % 4), 0, 0, 0);
  const secondStart = new Date(firstStart.getTime() + 3 * 60 * 60_000);
  return [
    {
      startsAt: firstStart,
      endsAt: new Date(firstStart.getTime() + 2 * 60 * 60_000),
      capacity: 1,
      isActive: true
    },
    {
      startsAt: secondStart,
      endsAt: new Date(secondStart.getTime() + 90 * 60_000),
      capacity: 1,
      isActive: true
    }
  ];
}

type SeedClient = {
  user: Pick<PrismaClient["user"], "upsert">;
  authIdentity: Pick<PrismaClient["authIdentity"], "upsert">;
  companionProfile: Pick<PrismaClient["companionProfile"], "upsert">;
  companionCommercialProfile: Pick<PrismaClient["companionCommercialProfile"], "upsert">;
  companionServiceTag: Pick<PrismaClient["companionServiceTag"], "deleteMany" | "upsert">;
  companionServiceOffering: Pick<PrismaClient["companionServiceOffering"], "upsert">;
  companionAvailabilityWindow: Pick<PrismaClient["companionAvailabilityWindow"], "deleteMany" | "createMany">;
  serviceTag: Pick<PrismaClient["serviceTag"], "upsert">;
};

export const seedStaffUsers = [
  {
    phone: "13800000001",
    role: "admin" as const,
    displayName: "运营管理员"
  },
  {
    phone: "13800000002",
    role: "moderator" as const,
    displayName: "内容审核员"
  }
];

export async function seedStaffAccounts(client: PrismaClient = prisma) {
  if (environment.APP_ENV === "production") {
    throw new Error("Demo/staff seed is disabled when APP_ENV=production");
  }
  for (const staff of seedStaffUsers) {
    const e164 = `+86${staff.phone}`;
    const existing = await client.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: "phone",
          providerId: e164
        }
      }
    });

    if (existing) {
      await client.user.update({
        where: { id: existing.userId },
        data: { role: staff.role }
      });
      await client.userProfile.upsert({
        where: { userId: existing.userId },
        create: {
          userId: existing.userId,
          displayName: staff.displayName,
          phone: e164,
          isVerified: true,
          safetyScore: 100
        },
        update: {
          displayName: staff.displayName,
          phone: e164,
          isVerified: true
        }
      });
      continue;
    }

    await client.user.create({
      data: {
        role: staff.role,
        profile: {
          create: {
            displayName: staff.displayName,
            phone: e164,
            isVerified: true,
            safetyScore: 100
          }
        },
        identities: {
          create: {
            provider: "phone",
            providerId: e164
          }
        }
      }
    });
  }
}

export async function seedDatabase(client: SeedClient = prisma) {
  if (environment.APP_ENV === "production") {
    throw new Error("Demo companion seed is disabled when APP_ENV=production");
  }
  for (const [index, companion] of seedCompanions.entries()) {
    const ownerUserId = `seed-owner-${companion.id}`;
    const ownerPhone = `+86138000001${String(index + 1).padStart(2, "0")}`;
    await client.user.upsert({
      where: { id: ownerUserId },
      create: {
        id: ownerUserId,
        role: "companion",
        profile: {
          create: {
            displayName: companion.name,
            phone: ownerPhone,
            isVerified: true,
            safetyScore: 100
          }
        }
      },
      update: {
        role: "companion",
        accountStatus: "active",
        profile: {
          upsert: {
              create: { displayName: companion.name, phone: ownerPhone, isVerified: true, safetyScore: 100 },
              update: { displayName: companion.name, phone: ownerPhone, isVerified: true }
          }
        }
      }
    });
    await client.authIdentity.upsert({
      where: { provider_providerId: { provider: "phone", providerId: ownerPhone } },
      create: { userId: ownerUserId, provider: "phone", providerId: ownerPhone },
      update: { userId: ownerUserId }
    });
    await client.companionProfile.upsert({
      where: { id: companion.id },
      create: {
        id: companion.id,
        ownerUserId,
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
        topicIds: deriveTopicIds(companion.specialties, companion.tags),
        completedOrders: companion.completedOrders,
        responseTime: companion.responseTime,
        distanceKm: companion.distanceKm,
        availability: companion.availability,
        cityDistrict: companion.cityDistrict,
        isPublished: companion.isVerified
      },
      update: {
        ownerUserId,
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
        topicIds: deriveTopicIds(companion.specialties, companion.tags),
        completedOrders: companion.completedOrders,
        responseTime: companion.responseTime,
        distanceKm: companion.distanceKm,
        availability: companion.availability,
        cityDistrict: companion.cityDistrict,
        isPublished: companion.isVerified
      }
    });
    await client.companionCommercialProfile.upsert({
      where: { companionId: companion.id },
      create: {
        companionId: companion.id,
        status: companion.isVerified ? "verified" : "pendingReview",
        settlementRecipientRef: `seed-recipient-${companion.id}`,
        settlementRecipientMasked: `STAGING-****-${companion.id.toUpperCase()}`,
        taxProfileRef: `seed-tax-${companion.id}`,
        identityEvidenceRef: `seed-identity-${companion.id}`,
        serviceAgreementVersion: "staging-v1",
        serviceAgreementEvidenceRef: `seed-agreement-${companion.id}`,
        submittedById: "seed-system",
        verifiedAt: companion.isVerified ? new Date() : null,
        verifiedById: companion.isVerified ? "seed-second-review" : null
      },
      update: {
        status: companion.isVerified ? "verified" : "pendingReview",
        settlementRecipientRef: `seed-recipient-${companion.id}`,
        settlementRecipientMasked: `STAGING-****-${companion.id.toUpperCase()}`,
        taxProfileRef: `seed-tax-${companion.id}`,
        identityEvidenceRef: `seed-identity-${companion.id}`,
        serviceAgreementVersion: "staging-v1",
        serviceAgreementEvidenceRef: `seed-agreement-${companion.id}`,
        submittedById: "seed-system",
        verifiedAt: companion.isVerified ? new Date() : null,
        verifiedById: companion.isVerified ? "seed-second-review" : null
      }
    });

    await client.companionServiceOffering.upsert({
      where: {
        companionId_code: {
          companionId: companion.id,
          code: "legacy-standard"
        }
      },
      create: {
        companionId: companion.id,
        code: "legacy-standard",
        title: "线上文字陪伴",
        description: "在平台内进行一对一文字沟通。",
        deliveryMode: "text",
        durationMinutes: 30,
        priceCents: companion.pricePerHalfHour * 100,
        currency: "CNY",
        topicIds: deriveTopicIds(companion.specialties, companion.tags),
        isActive: true,
        sortOrder: 0
      },
      update: {
        title: "线上文字陪伴",
        description: "在平台内进行一对一文字沟通。",
        deliveryMode: "text",
        durationMinutes: 30,
        priceCents: companion.pricePerHalfHour * 100,
        currency: "CNY",
        topicIds: deriveTopicIds(companion.specialties, companion.tags),
        isActive: true,
        sortOrder: 0
      }
    });

    await client.companionAvailabilityWindow.deleteMany({
      where: { companionId: companion.id }
    });
    await client.companionAvailabilityWindow.createMany({
      data: seedAvailabilityWindows(index).map((window) => ({
        companionId: companion.id,
        ...window
      }))
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
    .then(() => seedStaffAccounts())
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
