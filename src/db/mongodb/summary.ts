import * as mongoose from 'mongoose';
//Schema for user contents
const summarySchema = new mongoose.Schema({
  url: {
    type: String,
    require: true,
  },
  summary: {
    type: Object,
    required: true,
  },
  word_count: {
    type: Number,
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

const url_summary_schema = mongoose.model('Url_summary', summarySchema);
export default url_summary_schema;
