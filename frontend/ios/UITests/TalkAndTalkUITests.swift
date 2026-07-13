import XCTest

/// UITests are **not** a v0.1 release gate (login gate + copy drift). Prefer
/// unit tests + [docs/staging-acceptance.md](../../../docs/staging-acceptance.md) manual regression.
///
/// Debug offline demo (`FRONTEND_DEMO_MODE` default) is a **product-ready shell**:
/// no seeded companions / community posts / orders. Tests below assert that empty
/// product shell, or skip flows that require a real backend seed.
final class TalkAndTalkUITests: XCTestCase {
    @MainActor
    func testHomeScreenLaunchesWithPrimaryCTA() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.staticTexts["选择你的身份"].waitForExistence(timeout: 5))
        app.buttons["女生"].tap()
        XCTAssertTrue(app.staticTexts["Talk&Talk"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["现在的心情"].exists || app.staticTexts["可聊的人"].exists)
        XCTAssertTrue(app.buttons["先完成认证"].exists || app.buttons["找人聊聊"].exists)
        // No fake marketplace users in offline demo.
        XCTAssertFalse(app.staticTexts["林屿"].exists)
        XCTAssertTrue(
            app.staticTexts["暂时还没有人在线"].waitForExistence(timeout: 3)
                || app.staticTexts["现在的心情"].exists
        )
        XCTAssertTrue(tabButton(in: app, label: "发现", identifier: "sparkles").exists)
        XCTAssertTrue(tabButton(in: app, label: "广场", identifier: "heart.text.square").exists)
        XCTAssertTrue(tabButton(in: app, label: "订单", identifier: "calendar.badge.clock").exists)
        XCTAssertTrue(tabButton(in: app, label: "消息", identifier: "bubble.left.and.bubble.right").exists)
        XCTAssertTrue(tabButton(in: app, label: "我的", identifier: "person.crop.circle").exists)
    }

    @MainActor
    func testCommunityTabShowsEmptyShellWithoutSeededPosts() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        XCTAssertTrue(app.staticTexts["看看大家想聊什么"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["动态"].exists)
        XCTAssertTrue(app.buttons["全部"].exists)
        XCTAssertTrue(app.buttons["communityPublishButton"].exists)
        // Seeded demo copy must not appear.
        XCTAssertFalse(app.staticTexts["已实名，擅长稳定倾听。希望匹配需要安静沟通的人。"].exists)
        XCTAssertFalse(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].exists)
    }

    @MainActor
    func testFemaleCommunityPublishingUsesDemandComposerWithoutCover() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        XCTAssertTrue(app.buttons["communityPublishButton"].waitForExistence(timeout: 3))
        app.buttons["communityPublishButton"].tap()

        XCTAssertTrue(app.staticTexts["发一条需求"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["想说的话"].exists)
        XCTAssertFalse(app.staticTexts["封面"].exists)
        XCTAssertFalse(app.staticTexts["发布需求"].exists)
        XCTAssertFalse(app.staticTexts["发布自荐"].exists)
    }

    @MainActor
    func testUnverifiedMaleCommunityPromotionRoutesToVerification() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        app.buttons["communityPublishButton"].tap()

        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testVerifiedMaleCommunityPromotionShowsOptionalCover() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        completeVerification(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        app.buttons["communityPublishButton"].tap()

        XCTAssertTrue(app.staticTexts["发布自荐"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["自荐介绍"].exists)
        XCTAssertTrue(app.staticTexts["封面"].exists)
        XCTAssertTrue(app.buttons["communityComposeSubmit"].exists)
    }

    @MainActor
    func testCommunitySeededFeedFlowsRequireBackend() throws {
        throw XCTSkip("Offline demo no longer seeds community posts. Run with FRONTEND_DEMO_MODE=NO + backend seed; see staging-acceptance.md.")
    }

    @MainActor
    func testProfileGenderSettingsCanChangeIdentity() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "我的", identifier: "person.crop.circle")
        XCTAssertTrue(app.buttons["genderSettingsRow"].waitForExistence(timeout: 3))
        app.buttons["genderSettingsRow"].tap()

        XCTAssertTrue(app.staticTexts["身份设置"].waitForExistence(timeout: 3))
        app.buttons["男生"].tap()
        app.buttons["genderSettingsDoneButton"].tap()
        XCTAssertTrue(app.staticTexts["男生"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testMessagesTabShowsEmptyConversationShell() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "消息", identifier: "bubble.left.and.bubble.right")
        XCTAssertTrue(app.textFields["messageSearchBar"].waitForExistence(timeout: 3))
        XCTAssertTrue(
            app.staticTexts["平台内沟通 · 可举报"].waitForExistence(timeout: 3)
                || app.staticTexts["暂无会话"].exists
                || app.staticTexts["还没有会话"].exists
        )
        XCTAssertFalse(app.staticTexts["林屿"].exists)
    }

    @MainActor
    func testCompanionMarketplaceFlowsRequireBackend() throws {
        throw XCTSkip("Offline demo has no seeded companions. Use FRONTEND_DEMO_MODE=NO + backend seed for paid-chat / trial UI flows.")
    }

    @MainActor
    private func tapTab(in app: XCUIApplication, label: String, identifier: String) {
        let button = tabButton(in: app, label: label, identifier: identifier)
        XCTAssertTrue(button.waitForExistence(timeout: 3))
        button.tap()
    }

    @MainActor
    private func tabButton(in app: XCUIApplication, label: String, identifier: String) -> XCUIElement {
        let labeledTab = app.tabBars.buttons[label]
        if labeledTab.exists { return labeledTab }
        let identifiedTab = app.tabBars.buttons[identifier]
        if identifiedTab.exists { return identifiedTab }
        let labeledButton = app.buttons[label]
        if labeledButton.exists { return labeledButton }
        return app.buttons[identifier]
    }

    @MainActor
    private func chooseInitialGender(in app: XCUIApplication, gender: String = "女生") {
        XCTAssertTrue(app.staticTexts["选择你的身份"].waitForExistence(timeout: 5))
        app.buttons[gender].tap()
        XCTAssertTrue(
            app.staticTexts["现在的心情"].waitForExistence(timeout: 3)
                || app.staticTexts["可聊的人"].waitForExistence(timeout: 3)
        )
    }

    @MainActor
    private func completeVerification(in app: XCUIApplication) {
        let verifyCTA = app.buttons["先完成认证"].exists ? app.buttons["先完成认证"] : app.buttons["先完成 18+ 认证"]
        verifyCTA.tap()
        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))

        let nameField = app.textFields.element(boundBy: 0)
        nameField.tap()
        nameField.typeText("小楷")

        let ageField = app.textFields.element(boundBy: 1)
        ageField.tap()
        ageField.typeText("24")

        app.buttons["下一步"].tap()
        app.buttons["开始检测"].tap()
        app.buttons["下一步"].tap()

        let phoneField = app.textFields.element(boundBy: 0)
        phoneField.tap()
        phoneField.typeText("18300000012")

        let codeField = app.textFields.element(boundBy: 1)
        codeField.tap()
        codeField.typeText("123456")

        app.buttons["完成认证"].tap()
        XCTAssertTrue(
            app.buttons["找人聊聊"].waitForExistence(timeout: 3)
                || app.buttons["看看谁在线"].waitForExistence(timeout: 3)
        )
    }
}
