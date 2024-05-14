package com.wiloon.enx;

public class Word {
    private int id;
    private String english;
    private String chinese;
    private String pronunciation;

    public Word(int id, String english, String chinese, String pronunciation) {
        this.id = id;
        this.english = english;
        this.chinese = chinese;
        this.pronunciation = pronunciation;
    }

    public int getId() {
        return id;
    }
    public String getEnglish() {
        return english;
    }
    public String getChinese() {
        return chinese;
    }
    public String getPronunciation() {
        return pronunciation;
    }
    public void setId(int id) {
        this.id = id;
    }
    public void setEnglish(String english) {
        this.english = english;
    }
    public void setChinese(String chinese) {
        this.chinese = chinese;
    }
    public void setPronunciation(String pronunciation) {
        this.pronunciation = pronunciation;
    }
}
