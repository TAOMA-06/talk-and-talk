module.exports = {
  "groups": [
    {
      "key": "all",
      "label": "全部"
    },
    {
      "key": "core",
      "label": "核心"
    },
    {
      "key": "orders",
      "label": "订单"
    },
    {
      "key": "account",
      "label": "账户"
    },
    {
      "key": "companion",
      "label": "陪伴者"
    },
    {
      "key": "safety",
      "label": "安全"
    }
  ],
  "screens": [
    {
      "index": 1,
      "number": "01",
      "name": "01-consent",
      "title": "首次同意",
      "group": "core",
      "tone": "blue",
      "route": "/pages/consent/index",
      "shortRoute": "consent/index",
      "image": "/assets/screens/01-consent.jpg"
    },
    {
      "index": 2,
      "number": "02",
      "name": "02-home",
      "title": "首页",
      "group": "core",
      "tone": "apricot",
      "route": "/pages/home/index",
      "shortRoute": "home/index",
      "image": "/assets/screens/02-home.jpg"
    },
    {
      "index": 3,
      "number": "03",
      "name": "03-discover",
      "title": "发现",
      "group": "core",
      "tone": "mint",
      "route": "/pages/discover/index",
      "shortRoute": "discover/index",
      "image": "/assets/screens/03-discover.jpg"
    },
    {
      "index": 4,
      "number": "04",
      "name": "04-community",
      "title": "广场",
      "group": "core",
      "tone": "lavender",
      "route": "/pages/community/index",
      "shortRoute": "community/index",
      "image": "/assets/screens/04-community.jpg"
    },
    {
      "index": 5,
      "number": "05",
      "name": "05-orders",
      "title": "订单中心",
      "group": "orders",
      "tone": "butter",
      "route": "/pages/orders/index",
      "shortRoute": "orders/index",
      "image": "/assets/screens/05-orders.jpg"
    },
    {
      "index": 6,
      "number": "06",
      "name": "06-order-detail",
      "title": "订单详情",
      "group": "orders",
      "tone": "rose",
      "route": "/pages/order/detail?id=demo-20260828-u1-order-paid",
      "shortRoute": "order/detail",
      "image": "/assets/screens/06-order-detail.jpg"
    },
    {
      "index": 7,
      "number": "07",
      "name": "07-order-payment",
      "title": "支付确认",
      "group": "orders",
      "tone": "blue",
      "route": "/pages/order/payment?orderId=demo-20260828-u1-order-pending",
      "shortRoute": "order/payment",
      "image": "/assets/screens/07-order-payment.jpg"
    },
    {
      "index": 8,
      "number": "08",
      "name": "08-order-aftercare",
      "title": "评价与售后",
      "group": "orders",
      "tone": "apricot",
      "route": "/pages/order/aftercare?orderId=demo-20260828-u1-order-refunded",
      "shortRoute": "order/aftercare",
      "image": "/assets/screens/08-order-aftercare.jpg"
    },
    {
      "index": 9,
      "number": "09",
      "name": "09-order-dispute",
      "title": "订单争议",
      "group": "orders",
      "tone": "mint",
      "route": "/pages/order/dispute?orderId=demo-20260828-u1-order-refunded",
      "shortRoute": "order/dispute",
      "image": "/assets/screens/09-order-dispute.jpg"
    },
    {
      "index": 10,
      "number": "10",
      "name": "10-messages",
      "title": "消息",
      "group": "core",
      "tone": "lavender",
      "route": "/pages/messages/index",
      "shortRoute": "messages/index",
      "image": "/assets/screens/10-messages.jpg"
    },
    {
      "index": 11,
      "number": "11",
      "name": "11-notifications",
      "title": "通知",
      "group": "account",
      "tone": "butter",
      "route": "/pages/notifications/index",
      "shortRoute": "notifications/index",
      "image": "/assets/screens/11-notifications.jpg"
    },
    {
      "index": 12,
      "number": "12",
      "name": "12-profile",
      "title": "我的",
      "group": "core",
      "tone": "rose",
      "route": "/pages/profile/index",
      "shortRoute": "profile/index",
      "image": "/assets/screens/12-profile.jpg"
    },
    {
      "index": 13,
      "number": "13",
      "name": "13-account",
      "title": "账户与隐私",
      "group": "account",
      "tone": "blue",
      "route": "/pages/account/index",
      "shortRoute": "account/index",
      "image": "/assets/screens/13-account.jpg"
    },
    {
      "index": 14,
      "number": "14",
      "name": "14-adult-eligibility",
      "title": "成年资格",
      "group": "account",
      "tone": "apricot",
      "route": "/pages/account/adult-eligibility",
      "shortRoute": "account/adult-eligibility",
      "image": "/assets/screens/14-adult-eligibility.jpg"
    },
    {
      "index": 15,
      "number": "15",
      "name": "15-deletion-status",
      "title": "注销状态",
      "group": "account",
      "tone": "mint",
      "route": "/pages/account/deletion-status",
      "shortRoute": "account/deletion-status",
      "image": "/assets/screens/15-deletion-status.jpg"
    },
    {
      "index": 16,
      "number": "16",
      "name": "20-companion-detail",
      "title": "安全中心",
      "group": "safety",
      "tone": "lavender",
      "route": "/pages/companion/detail?id=c1",
      "shortRoute": "companion/detail",
      "image": "/assets/screens/20-companion-detail.jpg"
    },
    {
      "index": 17,
      "number": "17",
      "name": "16-safety",
      "title": "紧急帮助",
      "group": "safety",
      "tone": "butter",
      "route": "/pages/safety/index",
      "shortRoute": "safety/index",
      "image": "/assets/screens/16-safety.jpg"
    },
    {
      "index": 18,
      "number": "18",
      "name": "17-crisis",
      "title": "客服中心",
      "group": "safety",
      "tone": "rose",
      "route": "/pages/crisis/index",
      "shortRoute": "crisis/index",
      "image": "/assets/screens/17-crisis.jpg"
    },
    {
      "index": 19,
      "number": "19",
      "name": "18-support",
      "title": "客服详情",
      "group": "safety",
      "tone": "blue",
      "route": "/pages/support/index",
      "shortRoute": "support/index",
      "image": "/assets/screens/18-support.jpg"
    },
    {
      "index": 20,
      "number": "20",
      "name": "19-support-detail",
      "title": "陪伴者详情",
      "group": "core",
      "tone": "apricot",
      "route": "/pages/support/detail?id=demo-20260828-u1-support-resolved",
      "shortRoute": "support/detail",
      "image": "/assets/screens/19-support-detail.jpg"
    },
    {
      "index": 21,
      "number": "21",
      "name": "21-companion-workbench",
      "title": "陪伴者工作台",
      "group": "companion",
      "tone": "mint",
      "route": "/pages/companion/workbench/index",
      "shortRoute": "companion/workbench/index",
      "image": "/assets/screens/21-companion-workbench.jpg"
    },
    {
      "index": 22,
      "number": "22",
      "name": "22-companion-onboarding",
      "title": "陪伴者入驻",
      "group": "companion",
      "tone": "lavender",
      "route": "/pages/companion/onboarding/index",
      "shortRoute": "companion/onboarding/index",
      "image": "/assets/screens/22-companion-onboarding.jpg"
    },
    {
      "index": 23,
      "number": "23",
      "name": "23-companion-schedule",
      "title": "排班管理",
      "group": "companion",
      "tone": "butter",
      "route": "/pages/companion/schedule/index",
      "shortRoute": "companion/schedule/index",
      "image": "/assets/screens/23-companion-schedule.jpg"
    },
    {
      "index": 24,
      "number": "24",
      "name": "24-companion-development",
      "title": "成长与训练",
      "group": "companion",
      "tone": "rose",
      "route": "/pages/companion/development/index",
      "shortRoute": "companion/development/index",
      "image": "/assets/screens/24-companion-development.jpg"
    },
    {
      "index": 25,
      "number": "25",
      "name": "25-companion-earnings",
      "title": "收益",
      "group": "companion",
      "tone": "blue",
      "route": "/pages/companion/earnings/index",
      "shortRoute": "companion/earnings/index",
      "image": "/assets/screens/25-companion-earnings.jpg"
    },
    {
      "index": 26,
      "number": "26",
      "name": "26-companion-safety",
      "title": "陪伴者安全",
      "group": "companion",
      "tone": "apricot",
      "route": "/pages/companion/safety/index",
      "shortRoute": "companion/safety/index",
      "image": "/assets/screens/26-companion-safety.jpg"
    },
    {
      "index": 27,
      "number": "27",
      "name": "27-companion-services",
      "title": "服务管理",
      "group": "companion",
      "tone": "mint",
      "route": "/pages/companion/services/index",
      "shortRoute": "companion/services/index",
      "image": "/assets/screens/27-companion-services.jpg"
    },
    {
      "index": 28,
      "number": "28",
      "name": "28-companion-availability",
      "title": "可约时间",
      "group": "companion",
      "tone": "lavender",
      "route": "/pages/companion/availability/index",
      "shortRoute": "companion/availability/index",
      "image": "/assets/screens/28-companion-availability.jpg"
    },
    {
      "index": 29,
      "number": "29",
      "name": "29-chat",
      "title": "聊天",
      "group": "core",
      "tone": "butter",
      "route": "/pages/chat/index?id=c1",
      "shortRoute": "chat/index",
      "image": "/assets/screens/29-chat.jpg"
    },
    {
      "index": 30,
      "number": "30",
      "name": "30-voice",
      "title": "语音状态",
      "group": "core",
      "tone": "rose",
      "route": "/pages/voice/index?orderId=demo-20260828-u1-order-paid",
      "shortRoute": "voice/index",
      "image": "/assets/screens/30-voice.jpg"
    },
    {
      "index": 31,
      "number": "31",
      "name": "31-legal",
      "title": "法律文档",
      "group": "account",
      "tone": "blue",
      "route": "/pages/legal/index?type=privacy",
      "shortRoute": "legal/index",
      "image": "/assets/screens/31-legal.jpg"
    }
  ]
};
