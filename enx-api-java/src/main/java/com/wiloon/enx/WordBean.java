package com.wiloon.enx;

public class WordBean {
    private int Id;
    private String English;
    private String Chinese;
    private String Pronunciation;
    public WordBean(){
        
    }

    public WordBean(int id, String english, String chinese, String pronunciation) {
        this.Id = id;
        this.English = english;
        this.Chinese = chinese;
        this.Pronunciation = pronunciation;
    }

    public int getId() {
        return Id;
    }
    public void setId(int id) {
        this.Id = id;
    }
    public String getEnglish() {
        return English;
    }
    public void setEnglish(String english) {
        this.English = english;
    }
    public String getChinese() {
        return Chinese;
    }
    public void setChinese(String chinese) {
        this.Chinese = chinese;
    }
    public String getPronunciation() {
        return Pronunciation;
    }
    public void setPronunciation(String pronunciation) {
        this.Pronunciation = pronunciation;
    }
}
