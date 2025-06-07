let innerHtmlTest = `<p><a href="https://gitlab.com/">GitLab</a> has <a href="http://about.gitlab.com/releases/2025/05/15/gitlab-18-0-released/">released version 18.0</a> of its self-hosted DevSecOps platform, introducing more AI features across the <a href="http://about.gitlab.com/pricing/">Premium and Ultimate</a> tiers. The release includes AI-native development workflows, aligning GitLab with competitors like Microsoft&#39;s GitHub Copilot and other AI-assisted coding platforms. These AI capabilities include code suggestions, intelligent chat within integrated development environments, and automated code analysis.</span></p>`

let wordDict = {
    "GitLab": {
        "Id": 1024,
        "Raw": "their",
        "English": "their",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "their",
        "AlreadyAcquainted": 1,
        "LoadCount": 1,
        "WordType": 0
    },
    "has": {
        "Id": 298,
        "Raw": "to",
        "English": "to",
        "Chinese": "",
        "Pronunciation": "",
        "Key": "to",
        "AlreadyAcquainted": 1,
        "LoadCount": 0,
        "WordType": 0
    },
}

import {renderInnerHtml} from '../../content_module'

test('render test', () => {

  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)

  console.log("rendered inner html: ", renderedInnerHtml)
  expect(renderedInnerHtml).toBe(`scientists. (<u alt=\"their\" onclick=\"popEnxDialogBox(event)\" class=\"enx-their\" style=\"text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;\">Assassins</u> wove through traffic to attach “sticky bombs” to their car <u alt=\"to\" onclick=\"popEnxDialogBox(event)\" class=\"enx-to\" style=\"text-decoration: #FFFFFF underline; text-decoration-thickness: 2px;\">doors</u>.) The`);
});
