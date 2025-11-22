package service

import (
	"context"
	"enx-data-service/internal/db"
	"enx-data-service/internal/model"
	pb "enx-data-service/proto"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type DataService struct {
	pb.UnimplementedDataServiceServer
	db *db.Database
}

func NewDataService(db *db.Database) *DataService {
	return &DataService{db: db}
}

func (s *DataService) GetWord(ctx context.Context, req *pb.GetWordRequest) (*pb.GetWordResponse, error) {
	word, err := s.db.GetWord(req.Id)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "word not found: %v", err)
	}
	return &pb.GetWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) CreateWord(ctx context.Context, req *pb.CreateWordRequest) (*pb.CreateWordResponse, error) {
	word := &model.Word{
		English:    req.English,
		Chinese:    req.Chinese,
		Phonetic:   req.Phonetic,
		Definition: req.Definition,
	}

	if err := s.db.CreateWord(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create word: %v", err)
	}

	return &pb.CreateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) UpdateWord(ctx context.Context, req *pb.UpdateWordRequest) (*pb.UpdateWordResponse, error) {
	word := convertProtoToModel(req.Word)
	if err := s.db.UpdateWord(word); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update word: %v", err)
	}
	return &pb.UpdateWordResponse{Word: convertModelToProto(word)}, nil
}

func (s *DataService) DeleteWord(ctx context.Context, req *pb.DeleteWordRequest) (*pb.DeleteWordResponse, error) {
	if err := s.db.DeleteWord(req.Id); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete word: %v", err)
	}
	return &pb.DeleteWordResponse{Id: req.Id}, nil
}

func (s *DataService) SyncWords(req *pb.SyncWordsRequest, stream pb.DataService_SyncWordsServer) error {
	since, err := time.Parse(time.RFC3339, req.SinceDatetime)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid datetime format: %v", err)
	}

	words, err := s.db.SyncWords(since)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to fetch changes: %v", err)
	}

	for _, word := range words {
		if err := stream.Send(&pb.SyncWordsResponse{Word: convertModelToProto(word)}); err != nil {
			return err
		}
	}

	return nil
}

func convertModelToProto(w *model.Word) *pb.Word {
	return &pb.Word{
		Id:             w.ID,
		English:        w.English,
		Chinese:        w.Chinese,
		Phonetic:       w.Phonetic,
		Definition:     w.Definition,
		UpdateDatetime: w.UpdateDatetime.Format(time.RFC3339),
		IsDeleted:      w.IsDeleted,
	}
}

func convertProtoToModel(p *pb.Word) *model.Word {
	t, _ := time.Parse(time.RFC3339, p.UpdateDatetime)
	return &model.Word{
		ID:             p.Id,
		English:        p.English,
		Chinese:        p.Chinese,
		Phonetic:       p.Phonetic,
		Definition:     p.Definition,
		UpdateDatetime: t,
		IsDeleted:      p.IsDeleted,
	}
}
