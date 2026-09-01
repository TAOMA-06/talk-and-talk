import { ApiError, ensureSession } from "../../../utils/api";
import { clientVoiceIntroEnabled } from "../../../utils/config";
import {
  CommercialProfileSubmission,
  CompanionLifecycleOverview,
  companionCommercialApi
} from "../../../utils/companion-commercial-api";

type ViewState = "loading" | "application" | "ready" | "error";

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    VERIFICATION_REQUIRED: "请先在“我的”完成平台实名认证，再提交陪伴者申请。",
    APPLICATION_EXISTS: "当前账号已经提交过陪伴者申请，请下拉刷新。",
    COMPANION_PROFILE_CONTENT_REQUIRES_REVISION: "公开资料未通过内容安全检查，请修改后重试。",
    SETTLEMENT_RECIPIENT_ALREADY_BOUND: "该结算接收方引用已经绑定其他陪伴者，请联系平台核对。",
    VOICE_INTRO_METADATA_INCOMPLETE: "语音介绍引用和时长必须同时填写。",
    VOICE_INTRO_UNAVAILABLE: "首发文字陪伴不开放语音介绍，请只完善文字资料。",
    INVALID_COMPANION_PROFILE: "公开资料存在空白或重复项目，请检查。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    motionOff: false,
    brandName: "Talk&Talk",
    state: "loading" as ViewState,
    loading: true,
    saving: false,
    error: "",
    voiceIntroEnabled: clientVoiceIntroEnabled(),
    overview: null as CompanionLifecycleOverview | null,
    statusText: "",
    application: {
      role: "",
      bio: "",
      priceYuan: "39",
      tags: "",
      availableTimes: "",
      languages: "普通话",
      specialties: "",
      cityDistrict: ""
    },
    profile: {
      role: "",
      bio: "",
      languages: "",
      specialties: "",
      cityDistrict: "",
      livedExperience: "",
      serviceBoundaries: "",
      voiceIntroAssetRef: "",
      voiceIntroDurationSeconds: ""
    },
    commercial: {
      settlementRecipientRef: "",
      settlementRecipientMasked: "",
      taxProfileRef: "",
      identityEvidenceRef: "",
      serviceAgreementVersion: "",
      serviceAgreementEvidenceRef: ""
    }
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const overview = await companionCommercialApi.overview();
      const statusText: Record<string, string> = {
        notSubmitted: "商业资料未提交",
        pendingReview: "商业资料审核中",
        verified: "商业资料已通过",
        suspended: "商业资格已暂停"
      };
      this.setData({
        state: "ready",
        loading: false,
        voiceIntroEnabled: clientVoiceIntroEnabled(),
        overview,
        statusText: statusText[overview.commercialProfile.status] || overview.commercialProfile.status,
        profile: {
          role: overview.companion.role,
          bio: overview.companion.bio,
          languages: overview.companion.languages.join("，"),
          specialties: overview.companion.specialties.join("，"),
          cityDistrict: overview.companion.cityDistrict,
          livedExperience: overview.companion.livedExperience || "",
          serviceBoundaries: overview.companion.serviceBoundaries.join("，"),
          voiceIntroAssetRef: overview.companion.voiceIntro.assetReference || "",
          voiceIntroDurationSeconds: overview.companion.voiceIntro.durationSeconds
            ? String(overview.companion.voiceIntro.durationSeconds)
            : ""
        },
        commercial: {
          settlementRecipientRef: "",
          settlementRecipientMasked: overview.commercialProfile.settlementRecipientMasked || "",
          taxProfileRef: "",
          identityEvidenceRef: "",
          serviceAgreementVersion: overview.commercialProfile.serviceAgreementVersion || "",
          serviceAgreementEvidenceRef: ""
        }
      });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code === "COMPANION_PROFILE_NOT_FOUND") {
        this.setData({ state: "application", loading: false, overview: null });
      } else {
        this.setData({
          state: "error",
          loading: false,
          error: errorMessage(error, "入驻资料暂时无法加载，请稍后重试。")
        });
      }
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  setApplicationField(event: any) {
    const field = event.currentTarget.dataset.field as string;
    this.setData({ [`application.${field}`]: event.detail.value });
  },
  setProfileField(event: any) {
    const field = event.currentTarget.dataset.field as string;
    this.setData({ [`profile.${field}`]: event.detail.value });
  },
  setCommercialField(event: any) {
    const field = event.currentTarget.dataset.field as string;
    this.setData({ [`commercial.${field}`]: event.detail.value });
  },
  async submitApplication() {
    if (this.data.saving) return;
    const form = this.data.application;
    const priceYuan = Number(form.priceYuan);
    if (!Number.isFinite(priceYuan) || priceYuan <= 0) {
      this.setData({ error: "请填写有效的每30分钟价格。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      await companionCommercialApi.apply({
        role: form.role.trim(),
        bio: form.bio.trim(),
        pricePerHalfHour: Math.round(priceYuan),
        tags: splitList(form.tags),
        availableTimes: splitList(form.availableTimes),
        languages: splitList(form.languages),
        specialties: splitList(form.specialties),
        cityDistrict: form.cityDistrict.trim()
      });
      wx.showToast({ title: "基础资料已提交", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交入驻申请失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async saveProfile() {
    if (this.data.saving) return;
    const form = this.data.profile;
    const duration = form.voiceIntroDurationSeconds.trim()
      ? Number(form.voiceIntroDurationSeconds)
      : undefined;
    this.setData({ saving: true, error: "" });
    try {
      await companionCommercialApi.updateProfile({
        role: form.role.trim(),
        bio: form.bio.trim(),
        languages: splitList(form.languages),
        specialties: splitList(form.specialties),
        cityDistrict: form.cityDistrict.trim(),
        livedExperience: form.livedExperience.trim(),
        serviceBoundaries: splitList(form.serviceBoundaries),
        ...(clientVoiceIntroEnabled() && (form.voiceIntroAssetRef.trim() || duration !== undefined) ? {
          voiceIntroAssetRef: form.voiceIntroAssetRef.trim(),
          voiceIntroDurationSeconds: duration
        } : {})
      });
      wx.showToast({ title: "公开资料已保存", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "保存公开资料失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async submitCommercialProfile() {
    if (this.data.saving) return;
    const input = Object.fromEntries(
      Object.entries(this.data.commercial).map(([key, value]) => [key, String(value).trim()])
    ) as CommercialProfileSubmission;
    if (Object.values(input).some((value) => !value)) {
      this.setData({ error: "请填写全部外部引用、结算掩码和协议版本。不得填写证件或银行卡原文。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      await companionCommercialApi.submitCommercialProfile(input);
      wx.showToast({ title: "商业资料已提交", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交商业资料失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  openTraining() { wx.navigateTo({ url: "/pages/companion/development/index" }); },
  retry() { void this.load(); }
});
