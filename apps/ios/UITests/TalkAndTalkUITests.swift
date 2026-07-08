import XCTest

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
        XCTAssertTrue(app.staticTexts["从当下的心情开始"].exists)
        XCTAssertTrue(app.buttons["先完成 18+ 认证"].exists || app.buttons["看看谁在线"].exists)
        XCTAssertTrue(tabButton(in: app, label: "发现", identifier: "sparkles").exists)
        XCTAssertTrue(tabButton(in: app, label: "广场", identifier: "heart.text.square").exists)
        XCTAssertTrue(tabButton(in: app, label: "订单", identifier: "calendar.badge.clock").exists)
        XCTAssertTrue(tabButton(in: app, label: "消息", identifier: "bubble.left.and.bubble.right").exists)
        XCTAssertTrue(tabButton(in: app, label: "我的", identifier: "person.crop.circle").exists)
    }

    @MainActor
    func testCommunityTabShowsBelongingBanner() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        XCTAssertTrue(app.staticTexts["看看大家此刻想聊什么"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["广场动态"].exists)
        XCTAssertFalse(app.staticTexts["女生需求"].exists)
        XCTAssertFalse(app.buttons["男生自荐"].exists)
        XCTAssertTrue(app.buttons["全部"].exists)
        XCTAssertTrue(app.buttons["情绪倾听"].exists)
        XCTAssertTrue(app.buttons["communityPublishButton"].exists)
        XCTAssertTrue(app.staticTexts["已实名，擅长稳定倾听。希望匹配需要安静沟通的人。"].exists)
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
    func testCommunityFeedShowsOppositeGenderPosts() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        XCTAssertTrue(app.staticTexts["已实名，擅长稳定倾听。希望匹配需要安静沟通的人。"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].exists)
    }

    @MainActor
    func testMaleCommunityFeedShowsFemalePosts() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        tapTab(in: app, label: "广场", identifier: "heart.text.square")
        XCTAssertTrue(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["已实名，擅长稳定倾听。希望匹配需要安静沟通的人。"].exists)
    }

    @MainActor
    func testFemaleCanChatOrOrderFromVerifiedMaleCommunityPost() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")

        let chatButton = app.buttons["communityPostChat-p4"]
        XCTAssertTrue(chatButton.waitForExistence(timeout: 3))
        chatButton.tap()
        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["continuePaidChatButton"].exists)

        app.navigationBars.buttons.firstMatch.tap()
        let orderButton = app.buttons["communityPostOrder-p4"]
        XCTAssertTrue(orderButton.waitForExistence(timeout: 3))
        orderButton.tap()
        XCTAssertTrue(app.staticTexts["确认订单"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testMaleCanOpenFemaleCommunityPostAsSafetyChatOnly() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        tapTab(in: app, label: "广场", identifier: "heart.text.square")

        let chatButton = app.buttons["communityPostChat-p1"]
        XCTAssertTrue(chatButton.waitForExistence(timeout: 3))
        chatButton.tap()
        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["continuePaidChatButton"].exists)
    }

    @MainActor
    func testVerifiedMaleCanSendRecommendationCardInFemaleRequestChat() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        completeVerification(in: app)
        tapTab(in: app, label: "广场", identifier: "heart.text.square")

        let chatButton = app.buttons["communityPostChat-p1"]
        XCTAssertTrue(chatButton.waitForExistence(timeout: 3))
        chatButton.tap()

        XCTAssertTrue(app.buttons["chatMoreActions"].waitForExistence(timeout: 3))
        app.buttons["chatMoreActions"].tap()
        app.buttons["发送推荐卡片"].tap()

        let card = app.buttons["recommendationCard-self-u1"]
        XCTAssertTrue(card.waitForExistence(timeout: 3))
        card.tap()
        XCTAssertTrue(app.staticTexts["陪伴者详情"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["小楷"].exists)
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
    func testMessagesTabUsesConversationListAndOpensChat() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        tapTab(in: app, label: "消息", identifier: "bubble.left.and.bubble.right")
        XCTAssertTrue(app.textFields["messageSearchBar"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["平台内安全沟通"].exists)
        XCTAssertTrue(app.staticTexts["林屿"].exists)
        XCTAssertTrue(app.staticTexts["那我们先不急着解决。你觉得最压着你的，是事情多，还是没人理解？"].exists)

        app.buttons.containing(.staticText, identifier: "林屿").firstMatch.tap()
        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["发送"].exists)
        XCTAssertTrue(app.buttons["continuePaidChatButton"].exists)
    }

    @MainActor
    func testFreeTrialStartsChatWithoutOrderAndThenPromptsPayment() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()

        XCTAssertTrue(app.buttons["detailChat-c1"].waitForExistence(timeout: 3))
        app.buttons["detailChat-c1"].tap()

        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["试聊额度"].exists)

        for index in 1...5 {
            let input = app.textFields["messageInput"]
            XCTAssertTrue(input.waitForExistence(timeout: 3))
            input.tap()
            input.typeText("你好\(index)")
            app.buttons["发送"].tap()
        }

        XCTAssertTrue(app.staticTexts["试聊额度"].waitForExistence(timeout: 5))

        let input = app.textFields["messageInput"]
        input.tap()
        input.typeText("还想继续聊")
        app.buttons["发送"].tap()

        let alert = app.alerts["试聊额度已用完"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.buttons["确认订单后继续"].tap()
        XCTAssertTrue(app.staticTexts["确认订单"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testFreeTrialRequiresVerificationFromDetail() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        if !companion.isHittable {
            app.swipeUp()
        }
        companion.tap()

        XCTAssertTrue(app.buttons["detailChat-c1"].waitForExistence(timeout: 3))
        app.buttons["detailChat-c1"].tap()

        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testBlockedMessageDoesNotSendAndReducesSafetyScore() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()
        app.buttons["detailChat-c1"].tap()

        let input = app.textFields["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["试聊额度"].exists)
        input.tap()
        input.typeText("加微信")
        app.buttons["发送"].tap()

        XCTAssertTrue(app.staticTexts["消息未发送：疑似违规内容"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["加微信"].exists)
        XCTAssertTrue(app.staticTexts["试聊额度"].exists)

        let backButton = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(backButton.waitForExistence(timeout: 3))
        backButton.tap()

        XCTAssertTrue(tabButton(in: app, label: "我的", identifier: "person.crop.circle").waitForExistence(timeout: 3))
        tapTab(in: app, label: "我的", identifier: "person.crop.circle")
        XCTAssertTrue(app.staticTexts["65"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testPrimaryDemoFlowFromVerificationToReview() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()

        XCTAssertTrue(app.buttons["detailOrder-c1"].waitForExistence(timeout: 3))
        app.buttons["detailOrder-c1"].tap()

        XCTAssertTrue(app.staticTexts["确认订单"].waitForExistence(timeout: 3))
        app.switches["orderBoundaryToggle"].tap()
        app.buttons["确认并进入沟通"].tap()

        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        app.buttons["finishChatButton"].tap()
        XCTAssertTrue(app.staticTexts["这次沟通体验怎么样？"].waitForExistence(timeout: 3))
        app.buttons["提交评价"].tap()
        XCTAssertTrue(app.staticTexts["评价已提交"].waitForExistence(timeout: 3))
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
        XCTAssertTrue(app.staticTexts["从当下的心情开始"].waitForExistence(timeout: 3))
    }

    @MainActor
    private func completeVerification(in app: XCUIApplication) {
        app.buttons["先完成 18+ 认证"].tap()
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
        XCTAssertTrue(app.buttons["看看谁在线"].waitForExistence(timeout: 3))
    }
}
