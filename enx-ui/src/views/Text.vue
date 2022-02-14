<template>
  <div id="app">
    <v-app id="inspire">
      <v-container fluid>
        <v-row>
          <v-col cols="8">
            <v-row>
              <v-col
                cols="6"
                md="6"
              >
                <v-textarea
                  counter
                  outlined
                  rows="3"
                  name="input-7-4"
                  label="Outlined textarea"
                  v-model="text"
                ></v-textarea>
              </v-col>
              <v-col>
                <v-btn
                  depressed
                  color="primary"
                  @click="commit"
                >
                  Commit
                </v-btn>
              </v-col>

            </v-row>
            <v-row>
              <v-col
                cols="8"
              >
                <div v-for="(line,index) in article" :key="index">
                <span v-for="(word,index) in line.Words" :key="index"
                      @click="translate"
                      class="word"
                >{{ word }}</span>
                </div>
              </v-col>
            </v-row>
          </v-col>
          <v-col cols="4">
            <v-card
              class="mx-auto"
              max-width="400"
              tile
            >
              <v-list-item three-line v-for="(epc,index) in epcList" :key="index">
                <v-list-item-content>
                  <v-list-item-title>{{ epc.english }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ epc.pronunciation }}
                  </v-list-item-subtitle>
                  <v-list-item-subtitle>
                    {{ epc.chinese }}
                  </v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-card>
          </v-col>
        </v-row>

      </v-container>
    </v-app>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator'
import Axios from 'axios'

@Component({
  components: {}
})
export default class Home extends Vue {
  text = 'The Woodman set to work at once, and so sharp was his axe that the tree was soon chopped nearly through.'
  article = []
  dict = new Map()
  epcList = [
    {
      english: '',
      pronunciation: '',
      chinese: ''
    }
  ]

  commit (): void {
    Axios
      .get('/wrap', {
        params: { text: this.text }
      })
      .then(
        response => {
          console.log(response)
          this.article = response.data
        }
      )
  }

  translate (event: any): void {
    console.log(event)
    const el = event.currentTarget
    console.log(el.innerText)
    const word = el.innerText
    Axios
      .get('/translate', {
        params: { word: word }
      })
      .then(
        response => {
          console.log(response)
          this.dict = response.data
          this.epcList.reverse()
          this.epcList.push(
            {
              english: response.data.English,
              pronunciation: response.data.Pronunciation,
              chinese: response.data.Chinese
            }
          )

          this.epcList.reverse()
        }
      )
  }
}
</script>
<style scoped lang="stylus">
.word
  margin-right 5px
</style>
