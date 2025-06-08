let innerHtmlTest = `<p><a href="https://gitlab.com/">GitLab</a> has <a href="http://about.gitlab.com/releases/2025/05/15/gitlab-18-0-released/">released version 18.0</a> of its self-hosted DevSecOps platform, introducing more AI features across the <a href="http://about.gitlab.com/pricing/">Premium and Ultimate</a> tiers. The release includes AI-native development workflows</p>`

let wordDict = {
    "GitLab": {
        "Id": 1024,
        "Raw": "GitLab",
        "English": "GitLab",
        "Chinese": "一",
        "Pronunciation": "",
        "Key": "GitLab",
        "AlreadyAcquainted": 1,
        "LoadCount": 1,
        "WordType": 0
    }
}

import { renderInnerHtml } from '../../content_module';

test('render test', () => {

  let renderedInnerHtml = renderInnerHtml(innerHtmlTest, wordDict)

  console.log("rendered inner html: ", renderedInnerHtml)
  expect(renderedInnerHtml).toBe(`<p><a href=\"https://gitlab.com/\">GitLab</a> has <a href=\"http://about.gitlab.com/releases/2025/05/15/gitlab-18-0-released/\">released version 18.0</a> of its self-hosted DevSecOps platform, introducing more AI features across the <a href=\"http://about.gitlab.com/pricing/\">Premium and Ultimate</a> tiers. The release includes AI-native development workflows</p>`);
});
